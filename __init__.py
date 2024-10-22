from server import PromptServer
import os
from aiohttp import web
import aiohttp
import folder_paths
import hashlib
import json
import logging
import io
import mimetypes
import shutil
import asyncio
import time
from collections import Counter
import logging


# Set up logging
DEBUG = False
class ErrorOnlyFilter(logging.Filter):
    def filter(self, record):
        return record.levelno == logging.ERROR

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG if DEBUG else logging.ERROR)

handler = logging.StreamHandler()
handler.setLevel(logging.DEBUG if DEBUG else logging.ERROR)

formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)

logger.addHandler(handler)

if not DEBUG:
    error_filter = ErrorOnlyFilter()
    handler.addFilter(error_filter)

# Define the paths
PLUGIN_DIR = os.path.dirname(os.path.realpath(__file__))
LORA_DATA_DIR = os.path.join(PLUGIN_DIR, "loraData")
os.makedirs(LORA_DATA_DIR, exist_ok=True)

# Rate limiting settings
MAX_REQUESTS_PER_MINUTE = 120 # Increase at your own risk, don't get banned!
RATE_LIMITER = None

# Test limit constant
TEST_LIMIT = 0

# Add a global variable to track if processing is in progress
is_processing = False
LORA_FILE_INFO = {}

# hack for lora processing
class LoraDataStore:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(LoraDataStore, cls).__new__(cls)
            cls._instance.data = None
        return cls._instance

    @classmethod
    def set_data(cls, data):
        cls._instance = cls()
        cls._instance.data = data
        logger.info(f"Data set in LoraDataStore: {cls._instance.data}")

    @classmethod
    def get_data(cls):
        cls._instance = cls()
        print(f"Data retrieved from LoraDataStore: {cls._instance.data}")
        return cls._instance.data

    @classmethod
    def clear_data(cls):
        cls._instance = cls()
        cls._instance.data = None

class RateLimiter:
    def __init__(self, max_calls, period):
        self.max_calls = max_calls
        self.period = period  # in seconds
        self.calls = []
        self.lock = asyncio.Lock()

    async def acquire(self):
        async with self.lock:
            current = time.time()
            # Remove timestamps older than the period
            while self.calls and self.calls[0] <= current - self.period:
                self.calls.pop(0)
            if len(self.calls) >= self.max_calls:
                wait_time = self.period - (current - self.calls[0])
                logger.debug(f"Rate limit reached. Sleeping for {wait_time:.2f} seconds.")
                await asyncio.sleep(wait_time)
            self.calls.append(time.time())

# Initialize the RateLimiter
RATE_LIMITER = RateLimiter(MAX_REQUESTS_PER_MINUTE, 60)  # 120 calls per 60 seconds

async def hash_file(filepath):
    sha256_hash = hashlib.sha256()
    with open(filepath, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

async def fetch_model_info(session, model_id):
    url = f"https://civitai.com/api/v1/models/{model_id}"
    await RATE_LIMITER.acquire()  # Enforce rate limit
    async with session.get(url) as response:
        if response.status == 200:
            return await response.json()
    return None

async def fetch_version_info(session, file_hash):
    url = f"https://civitai.com/api/v1/model-versions/by-hash/{file_hash}"
    await RATE_LIMITER.acquire()  # Enforce rate limit
    async with session.get(url) as response:
        if response.status == 200:
            return await response.json()
    return None

async def fetch_version_info_by_id(session, version_id):
    url = f"https://civitai.com/api/v1/model-versions/{version_id}"
    await RATE_LIMITER.acquire()  # Enforce rate limit
    async with session.get(url) as response:
        if response.status == 200:
            return await response.json()
    return None

async def download_image(session, image_url, save_path):
    # await RATE_LIMITER.acquire()  # here in case but would rather not rate limit this
    async with session.get(image_url) as response:
        if response.status == 200:
            content_type = response.headers.get('Content-Type', '')
            ext = mimetypes.guess_extension(content_type) or '.jpg'
            final_save_path = f"{os.path.splitext(save_path)[0]}{ext}"
            with open(final_save_path, 'wb') as f:
                f.write(await response.read())
            return os.path.basename(final_save_path)
    return None

async def copy_placeholder_as_preview(lora_id):
    placeholder_path = os.path.join(LORA_DATA_DIR, "placeholder.jpeg")
    lora_folder = os.path.join(LORA_DATA_DIR, lora_id)
    preview_path = os.path.join(lora_folder, "preview.jpeg")
    
    # Ensure the LoRA folder exists
    os.makedirs(lora_folder, exist_ok=True)
    
    if os.path.exists(placeholder_path) and not os.path.exists(preview_path):
        shutil.copy(placeholder_path, preview_path)
        logger.info(f"Placeholder image copied as preview for LoRA {lora_id}")
    else:
        if not os.path.exists(placeholder_path):
            logger.warning(f"Placeholder image not found: {placeholder_path}")
        if os.path.exists(preview_path):
            logger.info(f"Preview already exists for LoRA {lora_id}: {preview_path}")

def get_subdir(file_path):
    # Split the drive from the file path (if there is one)
    file_drive, file_path_tail = os.path.splitdrive(file_path)
    current_drive = os.path.splitdrive(os.getcwd())[0]

    # If the file is on a different drive, fake it to be on the same drive
    if file_drive != current_drive:
        fake_file_path = os.path.join(current_drive, file_path_tail)
    else:
        fake_file_path = file_path

    subdir = os.path.relpath(os.path.dirname(fake_file_path))

    # Split and remove the first two directory levels cause Comfy
    subdir_parts = subdir.split(os.sep)
    if len(subdir_parts) > 2:
        subdir = os.sep.join(subdir_parts[2:])
    else:
        subdir = os.sep.join(subdir_parts)

    # Remove 'loras\\' prefix if it exists (for root loras directory)
    if subdir.startswith('loras\\'):
        subdir = subdir[6:]  # Remove the first 6 characters ('loras\\')

    return subdir

@PromptServer.instance.routes.get("/lora_sidebar/loras/list")
async def list_loras(request):
    global LORA_FILE_INFO
    logger.info("Pulling LoRA list from route:", request.path)
    logger.info("Pulling LoRA list")
    lora_dirs = folder_paths.get_folder_paths("loras")
    lora_files = []
   
    for lora_dir in lora_dirs:
        # Resolve symlinks to ensure proper path handling
        resolved_lora_dir = os.path.realpath(lora_dir)
        
        if os.path.exists(resolved_lora_dir):
            # Use os.walk to recursively walk through subfolders and resolve symlinks
            for root, dirs, files in os.walk(resolved_lora_dir, followlinks=True):
                for filename in files:
                    # Skip hidden files and system files starting with "._"
                    if filename.startswith('.') or filename.startswith('._'):
                        continue

                    file_path = os.path.join(root, filename)
                    
                    # Resolve any symlinks to their actual path and check if it's a file
                    resolved_file_path = os.path.realpath(file_path)
                    if os.path.isfile(resolved_file_path) and filename.lower().endswith(('.safetensors', '.ckpt', '.pt')):
                        lora_files.append({"filename": filename, "path": resolved_file_path})
                        
                        # Store in LORA_FILE_INFO
                        LORA_FILE_INFO[os.path.splitext(filename)[0].strip()] = {"filename": filename, "path": resolved_file_path}
                        
                        if TEST_LIMIT > 0 and len(lora_files) >= TEST_LIMIT:
                            break
                if TEST_LIMIT > 0 and len(lora_files) >= TEST_LIMIT:
                    break

    logger.info(f"LoRA list found, has {len(lora_files)}")
    
    return lora_files

@PromptServer.instance.routes.get("/lora_sidebar/preview/{lora_name}")
async def get_lora_preview(request):
    lora_name = request.match_info['lora_name']
    lora_folder = os.path.join(LORA_DATA_DIR, lora_name)
    for ext in ['.jpg', '.png', '.jpeg', '.mp4']:
        preview_path = os.path.join(lora_folder, f"preview{ext}")
        if os.path.exists(preview_path):
            return web.FileResponse(preview_path)
    
    # If no preview found, return 404
    return web.Response(status=404)

@PromptServer.instance.routes.get("/lora_sidebar/placeholder")
async def get_placeholder(request):
    placeholder_path = os.path.join(LORA_DATA_DIR, "placeholder.jpeg")
    if os.path.exists(placeholder_path):
        return web.FileResponse(placeholder_path)
    return web.Response(status=404)

@PromptServer.instance.routes.get("/lora_sidebar/unprocessed_count")
async def get_unprocessed_count(request):
    logger.info("Starting fresh: Scanning for unprocessed LoRAs")

    processed_loras_file = os.path.join(LORA_DATA_DIR, "processed_loras.json")

    # Load processed LoRAs
    if os.path.exists(processed_loras_file):
        with io.open(processed_loras_file, "r", encoding="utf-8") as f:
            try:
                processed_loras = json.load(f)
                if not isinstance(processed_loras, dict) or "loras" not in processed_loras:
                    processed_loras = {"loras": []}
            except json.JSONDecodeError:
                logger.error("Error reading processed_loras.json. Starting fresh.")
                processed_loras = {"loras": []}
    else:
        processed_loras = {"loras": []}
        logger.info("No processed_loras.json found. Starting fresh.")

    logger.info(f"Number of previously processed LoRAs: {len(processed_loras['loras'])}")

    # Get the current LoRA files
    lora_files = await list_loras(request)

    unprocessed_count = 0
    new_loras = []
    moved_loras = []
    duplicate_loras = []

    # Create a dictionary of processed LoRAs (keyed by filename)
    processed_loras_dict = {lora['filename']: lora['path'] for lora in processed_loras['loras']}

    # Create a dictionary of current LoRAs (keyed by filename) and count occurrences
    current_loras = {os.path.splitext(lf['filename'])[0].strip(): lf['path'] for lf in lora_files}
    filename_count = Counter(current_loras.keys())
    potential_duplicates = [filename for filename, count in filename_count.items() if count > 1]

    # Detect new, moved, and duplicate LoRAs
    for base_filename, file_path in current_loras.items():
        if base_filename in potential_duplicates:
            if base_filename not in processed_loras_dict:
                logger.info(f"New LoRA found (potential duplicate): {base_filename}")
                new_loras.append(base_filename)
                unprocessed_count += 1
            elif processed_loras_dict[base_filename] != file_path:
                logger.info(f"LoRA moved (potential duplicate): {base_filename}")
                moved_loras.append(base_filename)
                unprocessed_count += 1
            duplicate_loras.append(base_filename)
        else:
            if base_filename not in processed_loras_dict:
                logger.info(f"New LoRA found: {base_filename}")
                new_loras.append(base_filename)
                unprocessed_count += 1
            elif processed_loras_dict[base_filename] != file_path:
                logger.info(f"LoRA moved: {base_filename}")
                moved_loras.append(base_filename)
                unprocessed_count += 1

    # Check for missing LoRAs
    missing_loras = [lora for lora in processed_loras_dict.keys() if lora not in current_loras]

    logger.info(f"Total LoRAs: {len(lora_files)}, Unprocessed: {unprocessed_count}")
    logger.info(f"New: {len(new_loras)}, Moved: {len(moved_loras)}, Duplicates: {len(duplicate_loras)}, Missing: {len(missing_loras)}")

    response_data = {
        "unprocessed_count": unprocessed_count,
        "new_loras": new_loras,
        "moved_loras": moved_loras,
        "duplicate_loras": duplicate_loras,
        "missing_loras": missing_loras
    }

    LoraDataStore.set_data(response_data)
    return web.json_response(response_data)


@PromptServer.instance.routes.get("/lora_sidebar/estimate")
async def estimate_processing_time(request):
    # Extract 'count' from query parameters
    params = request.rel_url.query
    count_str = params.get('count', '0')
    
    try:
        num_unprocessed = int(count_str)
    except ValueError:
        logger.error(f"Invalid count parameter: {count_str}")
        return web.json_response({"error": "Invalid count parameter"}, status=400)
    
    # Calculate estimated seconds
    estimated_seconds = 1.85 * num_unprocessed  # 1.85 seconds per LoRA

    # Determine estimated_time_minutes string
    if estimated_seconds < 60:
        estimated_time_minutes = "Less than 1 minute"
    else:
        estimated_minutes = estimated_seconds / 60
        estimated_time_minutes = f"{round(estimated_minutes, 2)} minute(s)"

    logger.debug(f"Estimated processing time: {estimated_seconds} seconds ({estimated_time_minutes})")

    # Prepare and return JSON response
    return web.json_response({
        "total_unprocessed_loras": num_unprocessed,
        "estimated_time_seconds": round(estimated_seconds, 2),
        "estimated_time_minutes": estimated_time_minutes
    })

@PromptServer.instance.routes.get("/lora_sidebar/is_processing")
async def is_processing_handler(request):
    """Endpoint to check if LoRA processing is currently running."""
    return web.json_response({"is_processing": is_processing})

@PromptServer.instance.routes.get("/lora_sidebar/process")
async def process_loras(request):
    global is_processing, LORA_FILE_INFO
    
    # Check if processing is already in progress
    if is_processing:
        return web.json_response({
            "status": "Processing already in progress",
            "processed_count": 0,
            "total_count": 0,
            "skipped_count": 0
        }, status=400)

    is_processing = True

    try:
        # Check if we have the unprocessed data
        unprocessed_info = LoraDataStore.get_data()
        
        if unprocessed_info is None:
            # If not, we need to call get_unprocessed_count
            print("Unprocessed data not found, calling get_unprocessed_count")
            unprocessed_response = await get_unprocessed_count(request)
            unprocessed_info = LoraDataStore.get_data()

        if unprocessed_info is None:
            raise ValueError("Failed to retrieve unprocessed LoRAs data")

        print(f"Unprocessed info in process_loras: {unprocessed_info}")

        new_loras = unprocessed_info.get('new_loras', [])
        moved_loras = unprocessed_info.get('moved_loras', [])
        missing_loras = unprocessed_info.get('missing_loras', [])

        processed_count = 0
        skipped_count = 0
        total_count = len(new_loras) + len(moved_loras) + len(missing_loras)

        # Path to the processed LoRAs JSON file
        processed_loras_file = os.path.join(LORA_DATA_DIR, "processed_loras.json")

        # Load existing processed LoRAs
        if os.path.exists(processed_loras_file):
            with io.open(processed_loras_file, "r", encoding="utf-8") as f:
                try:
                    processed_loras = json.load(f)
                    if not isinstance(processed_loras, dict):
                        logger.warning("processed_loras.json is malformed. Expected a dictionary.")
                        processed_loras = {"loras": []}
                except json.JSONDecodeError:
                    logger.error("Error decoding processed_loras.json. Starting with empty data.")
                    processed_loras = {"loras": []}
        else:
            processed_loras = {"loras": []}
            logger.info("No processed_loras.json found. Starting with empty data.")

        logger.info(f"Found {len(new_loras)} new LoRAs, {len(moved_loras)} moved LoRAs, and {len(missing_loras)} missing LoRAs to process.")

        async with aiohttp.ClientSession() as session:

            # Process both new and moved LoRAs
            loras_to_process = new_loras + moved_loras  # Combine both lists

            # Process new LoRAs
            for lora_file in loras_to_process:
                filename = lora_file #should remove i think
                base_filename = lora_file
                lora_folder = os.path.join(LORA_DATA_DIR, base_filename)
                
                # Check if LoRA is already processed by verifying the existence of 'info.json'
                info_json_path = os.path.join(lora_folder, "info.json")
                if os.path.exists(info_json_path):
                    skipped_count += 1
                    logger.info(f"Skipping already processed LoRA: {filename}")
                    
                    # Get the file path from LORA_FILE_INFO
                    lora_info = LORA_FILE_INFO.get(base_filename)
                    if lora_info:
                        new_path = lora_info['path']
                        new_subdir = get_subdir(new_path)
                        path_updated = False
                        
                        # Check if the LoRA exists in processed_loras.json
                        existing_entry = next((item for item in processed_loras["loras"] 
                                            if item.get("filename") == base_filename), None)
                        
                        # Update processed_loras.json if needed
                        if existing_entry is None:
                            # Add new entry with filename and path
                            processed_loras["loras"].append({
                                "filename": base_filename,
                                "path": new_path
                            })
                            path_updated = True
                        elif existing_entry.get("path") != new_path:
                            # Update path if it has changed
                            existing_entry["path"] = new_path
                            path_updated = True

                        # If the path was updated, also update info.json
                        if path_updated:
                            try:
                                # Update info.json with new path and subdir
                                with open(info_json_path, "r+", encoding="utf-8") as f:
                                    info_data = json.load(f)
                                    if info_data.get("path") != new_path or info_data.get("subdir") != new_subdir:
                                        info_data["path"] = new_path
                                        info_data["subdir"] = new_subdir
                                        f.seek(0)
                                        json.dump(info_data, f, indent=4)
                                        f.truncate()
                                        logger.info(f"Updated path and subdir for moved LoRA in info.json: {filename}")

                                # Update processed_loras.json
                                with open(processed_loras_file, 'w', encoding="utf-8") as f:
                                    json.dump(processed_loras, f, indent=4, ensure_ascii=False)
                                logger.debug(f"Updated processed_loras.json for moved LoRA: {filename}")
                                
                                # Since we handled the move here, remove it from moved_loras if present
                                if filename in moved_loras:
                                    moved_loras.remove(filename)
                                    processed_count += 1  # Count this as processed since we handled the move
                                    
                                    # Send progress update
                                    progress = int(((processed_count + skipped_count) / total_count) * 100)
                                    await PromptServer.instance.send_json("lora_process_progress", {
                                        "progress": progress,
                                        "completed": processed_count + skipped_count,
                                        "total": total_count
                                    })
                                
                            except Exception as e:
                                logger.error(f"Failed to update path/subdir information for '{filename}': {e}")
                    
                    continue
                
                try:
                    # Process LoRA without creating the folder first
                    logger.info(f"Processing {filename}")

                    # Get the file path from LORA_FILE_INFO - let's add proper error handling here
                    if LORA_FILE_INFO is None:
                        raise ValueError(f"LORA_FILE_INFO is None when processing {filename}")

                    # Get the file path from LORA_FILE_INFO
                    lora_info = LORA_FILE_INFO.get(base_filename)
                    if not lora_info:
                        raise ValueError(f"No entry in LORA_FILE_INFO for {base_filename}. Available keys: {list(LORA_FILE_INFO.keys())[:5]}")
                    
                    file_path = lora_info['path']
                    file_hash = await hash_file(file_path)
                    version_info = await fetch_version_info(session, file_hash)

                    # Calculate subdir, handling symlink issues and cross-drive paths
                    subdir = get_subdir(file_path)
                    
                    if version_info:
                        # Prepare data to save
                        info_to_save = {
                            "name": version_info.get('model', {}).get('name', filename),
                            "modelId": version_info.get('modelId'),
                            "versionId": version_info.get('id'),
                            "versionName": version_info.get('name'),
                            "tags": [],
                            "trained_words": version_info.get('trainedWords', []),
                            "baseModel": version_info.get('baseModel'),
                            "images": [],
                            "nsfw": version_info.get('model', {}).get('nsfw', False),
                            "nsfwLevel": 0,
                            "description": version_info.get('description'),
                            "subdir": subdir,
                            "path": file_path
                        }
                        
                        # Fetch model info if available
                        model_id = info_to_save["modelId"]
                        if model_id:
                            model_info = await fetch_model_info(session, model_id)
                            if model_info:
                                info_to_save["tags"] = model_info.get('tags', [])
                                info_to_save["nsfwLevel"] = model_info.get('nsfwLevel', 0)
                        
                        # Process images
                        for image in version_info.get('images', []):
                            info_to_save['images'].append({
                                "url": image.get('url'),
                                "type": image.get('type'),
                                "nsfwLevel": image.get('nsfwLevel', 0),
                                "hasMeta": image.get('hasMeta', False)
                            })

                        # Handle trained_words
                        trained_words = version_info.get('trainedWords', [])
                        if isinstance(trained_words, list):
                            if len(trained_words) == 1 and ',' in trained_words[0]:
                                # Split the comma-separated string into a list
                                info_to_save["trained_words"] = [word.strip() for word in trained_words[0].split(',') if word.strip()]
                            else:
                                # Already a list, just use it as is
                                info_to_save["trained_words"] = trained_words
                        elif isinstance(trained_words, str):
                            # If it's a single string, split it by commas
                            info_to_save["trained_words"] = [word.strip() for word in trained_words.split(',') if word.strip()]
                        else:
                            # Fallback to an empty list if it's neither a list nor a string
                            info_to_save["trained_words"] = []
                        
                        # Download the first image as preview
                        if info_to_save['images']:
                            preview_path = os.path.join(LORA_DATA_DIR, filename, "preview")
                            os.makedirs(os.path.dirname(preview_path), exist_ok=True)  # Ensure preview directory exists
                            preview_filename = await download_image(session, info_to_save['images'][0]['url'], preview_path)
                            if preview_filename:
                                logger.info(f"Saved preview image as {preview_filename}")
                        else:
                            # If no images are available, copy the placeholder as the preview
                            await copy_placeholder_as_preview(base_filename)
                        
                        # Create the LoRA folder after successful processing
                        os.makedirs(lora_folder, exist_ok=True)
                        
                        # Save information to a JSON file
                        info_file_path = os.path.join(lora_folder, "info.json")
                        with open(info_file_path, "w", encoding="utf-8") as f:
                            json.dump(info_to_save, f, indent=4)
                    
                    else:
                        logger.info(f"Failed to fetch info for {filename}, treating it as a custom LoRA.")
                        info_to_save = {
                            "name": filename,  # Use filename as the name for custom LoRAs
                            "modelId": None,
                            "versionId": None,
                            "versionName": None,
                            "tags": [],
                            "trained_words": [],
                            "baseModel": "custom",  # Custom for dropdown
                            "images": [],
                            "nsfw": False,
                            "nsfwLevel": 0,
                            "description": "Custom LoRA",  # Default description for custom LoRAs
                            "subdir": subdir,
                            "path": file_path
                        }
                        # Copy the placeholder image as preview
                        await copy_placeholder_as_preview(base_filename)

                        # Create the LoRA folder
                        os.makedirs(lora_folder, exist_ok=True)

                        # Save the minimal info.json
                        info_file_path = os.path.join(lora_folder, "info.json")
                        with open(info_file_path, "w", encoding="utf-8") as f:
                            json.dump(info_to_save, f, indent=4)

                    logger.info(f"Processed {filename}")
                    processed_count += 1
                    processed_loras["loras"].append({
                        "filename": base_filename,
                        "path": file_path  # Include the path here
                    })
                    with open(processed_loras_file, 'w', encoding="utf-8") as f:
                        json.dump(processed_loras, f, indent=4, ensure_ascii=False)
                
                except Exception as e:
                    logger.error(f"Error processing {filename}: {str(e)}")
                    # Remove the folder if it was partially created
                    if os.path.exists(lora_folder):
                        shutil.rmtree(lora_folder)
                
                # Send progress update
                progress = int(((processed_count + skipped_count) / total_count) * 100)
                await PromptServer.instance.send_json("lora_process_progress", {
                    "progress": progress,
                    "completed": processed_count + skipped_count,
                    "total": total_count
                })

            # Handle missing LoRAs
            for missing_lora in missing_loras:
                lora_folder = os.path.join(LORA_DATA_DIR, missing_lora)
                try:
                    # Remove the folder if it exists
                    if os.path.exists(lora_folder):
                        shutil.rmtree(lora_folder)
                        logger.info(f"Removed folder for missing LoRA: {missing_lora}")

                    # Remove from processed_loras.json
                    processed_loras["loras"] = [
                        lora for lora in processed_loras["loras"] 
                        if lora.get("filename") != missing_lora
                    ]
                    
                    # Save updated processed_loras.json
                    with open(processed_loras_file, 'w', encoding="utf-8") as f:
                        json.dump(processed_loras, f, indent=4, ensure_ascii=False)
                    logger.info(f"Removed {missing_lora} from processed_loras.json")
                    
                    processed_count += 1
                    
                except Exception as e:
                    logger.error(f"Error handling missing LoRA {missing_lora}: {str(e)}")
                    skipped_count += 1

                # Send progress update
                progress = int(((processed_count + skipped_count) / total_count) * 100)
                await PromptServer.instance.send_json("lora_process_progress", {
                    "progress": progress,
                    "completed": processed_count + skipped_count,
                    "total": total_count
                })

    finally:
        is_processing = False  # Ensure flag is reset when processing finishes
        LoraDataStore.clear_data()

    return web.json_response({
        "status": "Processing complete",
        "processed_count": processed_count,
        "total_count": total_count,
        "skipped_count": skipped_count
    })


@PromptServer.instance.routes.get("/lora_sidebar/data")
async def get_lora_data(request):
    logger.info("Fetching LoRA data")
    
    # Get offset and limit from query parameters
    offset = int(request.query.get('offset', 0))
    limit = int(request.query.get('limit', 500))  # Default to 500 if not provided
    
    lora_data = []
    processed_loras_file = os.path.join(LORA_DATA_DIR, "processed_loras.json")
   
    # Load favorites
    favorites = []
    if os.path.exists(processed_loras_file):
        with open(processed_loras_file, "r", encoding="utf-8") as f:
            try:
                processed_loras = json.load(f)
                favorites = processed_loras.get('favorites', [])
            except json.JSONDecodeError:
                logger.error("Error reading processed_loras.json.")
                favorites = []
    
    # List all folders in the LoRA data directory
    all_folders = [folder for folder in os.listdir(LORA_DATA_DIR) 
                   if os.path.isdir(os.path.join(LORA_DATA_DIR, folder))]

    # Ensure favorites are prioritized only in the first batch
    favorite_folders = []
    non_favorite_folders = []

    for folder in all_folders:
        if folder in favorites:
            favorite_folders.append(folder)
        else:
            non_favorite_folders.append(folder)
    
    # For the first batch (offset == 0), include the favorites
    if offset == 0:
        folders_to_process = favorite_folders[:limit] + non_favorite_folders[:max(0, limit - len(favorite_folders))]
    else:
        # For subsequent batches, only load non-favorites
        folders_to_process = non_favorite_folders[offset - len(favorite_folders):offset + limit - len(favorite_folders)]

    # Fetch data for the selected folders
    processed_ids = set()
    for folder in folders_to_process:
        if folder not in processed_ids:
            info_file = os.path.join(LORA_DATA_DIR, folder, "info.json")
            if os.path.exists(info_file):
                with open(info_file, "r", encoding="utf-8") as f:
                    try:
                        data = json.load(f)
                        data['id'] = folder  # Add the folder name as 'id'

                        # Get the filename and path from LORA_FILE_INFO
                        if folder in LORA_FILE_INFO:
                            data['filename'] = LORA_FILE_INFO[folder]['filename']
                            data['path'] = LORA_FILE_INFO[folder]['path']
                        else:
                            # Fallback to default if not found
                            data['filename'] = f"{folder}.safetensors"
                            data['path'] = ""

                        lora_data.append(data)
                        processed_ids.add(folder)
                    except json.JSONDecodeError:
                        logger.error(f"Error reading {info_file}. Skipping.")
   
    logger.info(f"Fetched data for {len(lora_data)} LoRAs (offset: {offset}, limit: {limit})")
    
    # Check if there are more LoRAs to load
    has_more = (offset + limit) < len(non_favorite_folders)
    
    return web.json_response({
        "loras": lora_data, 
        "favorites": favorites if offset == 0 else [],  # Send favorites only in the first batch
        "hasMore": has_more,
        "totalCount": len(all_folders)
    })



@PromptServer.instance.routes.post("/lora_sidebar/toggle_favorite")
async def toggle_favorite(request):
    data = await request.json()
    lora_id = data.get('id')
    
    processed_loras_file = os.path.join(LORA_DATA_DIR, "processed_loras.json")
    
    if os.path.exists(processed_loras_file):
        with open(processed_loras_file, 'r', encoding="utf-8") as f:
            try:
                processed_loras = json.load(f)
            except json.JSONDecodeError:
                logger.error("Error reading processed_loras.json. Initializing.")
                processed_loras = {"favorites": []}
    else:
        processed_loras = {"favorites": []}
    
    if 'favorites' not in processed_loras:
        processed_loras['favorites'] = []
    
    if lora_id in processed_loras['favorites']:
        processed_loras['favorites'].remove(lora_id)
        is_favorite = False
    else:
        processed_loras['favorites'].append(lora_id)
        is_favorite = True
    
    with open(processed_loras_file, 'w', encoding="utf-8") as f:
        json.dump(processed_loras, f, indent=4)
    
    return web.json_response({"favorite": is_favorite})

@PromptServer.instance.routes.post("/lora_sidebar/refresh/{version_id}")
async def refresh_lora(request):
    version_id = request.match_info['version_id']
    processed_loras_file = os.path.join(LORA_DATA_DIR, "processed_loras.json")

    async with aiohttp.ClientSession() as session:
        try:
            # Find the existing LoRA folder based on version ID
            existing_lora_folder = None
            existing_info = None
            base_filename = None
            for folder in os.listdir(LORA_DATA_DIR):
                info_file_path = os.path.join(LORA_DATA_DIR, folder, "info.json")
                if os.path.exists(info_file_path):
                    with open(info_file_path, "r") as f:
                        folder_info = json.load(f)
                        if str(folder_info.get("versionId")) == str(version_id):
                            existing_lora_folder = os.path.join(LORA_DATA_DIR, folder)
                            existing_info = folder_info
                            base_filename = folder
                            break

            if not existing_lora_folder or not existing_info:
                logger.warning(f"LoRA with version ID {version_id} not found.")
                return web.json_response({
                    "status": "error",
                    "message": f"LoRA with version ID {version_id} not found"
                }, status=404)

            # Fetch updated version info
            version_info = await fetch_version_info_by_id(session, version_id)
            if not version_info:
                logger.error("Failed to fetch updated version info.")
                return web.json_response({
                    "status": "error",
                    "message": "Failed to fetch updated version info"
                }, status=400)

            # Initialize updates dictionary
            updates = {}

            # 1. Update 'name' correctly from 'model.name'
            new_name = version_info.get('model', {}).get('name', existing_info.get('name'))
            if new_name and new_name != existing_info.get('name'):
                updates['name'] = new_name

            # 2. Update 'trained_words' correctly from 'trainedWords'
            new_trained_words = version_info.get('trainedWords', existing_info.get('trained_words'))
            if new_trained_words:
                if isinstance(new_trained_words, str):
                    # Convert comma-separated string to a list
                    new_trained_words = [word.strip() for word in new_trained_words.split(',') if word.strip()]
                elif isinstance(new_trained_words, list):
                    # Ensure all elements are strings and stripped
                    new_trained_words = [str(word).strip() for word in new_trained_words]
                else:
                    # If neither string nor list, retain existing 'trained_words'
                    new_trained_words = existing_info.get('trained_words')

                if new_trained_words and new_trained_words != existing_info.get('trained_words'):
                    updates['trained_words'] = new_trained_words

            # 3. Update 'baseModel' correctly
            new_base_model = version_info.get('baseModel')
            if new_base_model and new_base_model != existing_info.get('baseModel'):
                updates['baseModel'] = new_base_model

            # 4. Update 'description' correctly
            new_description = version_info.get('description')
            if new_description and new_description != existing_info.get('description'):
                updates['description'] = new_description

            # 5. Check if there are new images
            new_images = version_info.get('images')
            if new_images and new_images != existing_info.get('images'):
                updates['images'] = [
                    {
                        "url": image.get('url'),
                        "type": image.get('type'),
                        "nsfwLevel": image.get('nsfwLevel', 0),
                        "hasMeta": image.get('hasMeta', False)
                    } for image in new_images
                ]

            # If there are updates, apply them
            if updates:
                logger.info(f"Applying updates to LoRA {existing_lora_folder}: {updates}")
                existing_info.update(updates)

                # Update the path if it has changed
                if LORA_FILE_INFO.get(base_filename):
                    new_path = LORA_FILE_INFO[base_filename]['path']
                    if new_path != existing_info.get('path'):
                        existing_info['path'] = new_path
                        existing_info['subdir'] = get_subdir(new_path)
                        
                        # Update processed_loras.json with new path
                        if os.path.exists(processed_loras_file):
                            with open(processed_loras_file, 'r', encoding="utf-8") as f:
                                processed_loras = json.load(f)
                            
                            # Update the path in processed_loras
                            for lora in processed_loras.get('loras', []):
                                if lora.get('filename') == base_filename:
                                    lora['path'] = new_path
                                    break
                            
                            # Save updated processed_loras
                            with open(processed_loras_file, 'w', encoding="utf-8") as f:
                                json.dump(processed_loras, f, indent=4, ensure_ascii=False)

                # Only update the preview image if there's a new first image
                if 'images' in updates and updates['images']:
                    preview_path = os.path.join(existing_lora_folder, "preview")
                    preview_filename = await download_image(session, updates['images'][0]['url'], preview_path)
                    if preview_filename:
                        logger.info(f"Updated preview image as {preview_filename}")

                # Save updated information to the existing JSON file
                info_file_path = os.path.join(existing_lora_folder, "info.json")
                with open(info_file_path, "w", encoding="utf-8") as f:
                    json.dump(existing_info, f, indent=4)

                logger.info(f"Updated LoRA info.json for folder {existing_lora_folder}.")

                return web.json_response({"status": "success", "data": existing_info})
            else:
                logger.info(f"No updates required for LoRA with version ID {version_id}.")
                return web.json_response({"status": "success", "message": "No updates required"})

        except Exception as e:
            logger.error(f"Error refreshing LoRA: {str(e)}")
            return web.json_response({"status": "error", "message": str(e)}, status=500)
        

@PromptServer.instance.routes.post("/lora_sidebar/refresh/{lora_id}")
async def refresh_lora(request):
    lora_id = request.match_info['lora_id']
    lora_folder = os.path.join(LORA_DATA_DIR, lora_id)
    info_json_path = os.path.join(lora_folder, "info.json")

    if not os.path.exists(info_json_path):
        return web.json_response({"status": "error", "message": "LoRA not found"}, status=404)

    with open(info_json_path, "r", encoding="utf-8") as f:
        info_data = json.load(f)

    model_id = info_data.get("modelId")
    version_id = info_data.get("versionId")

    async with aiohttp.ClientSession() as session:
        try:
            # If no model or version ID, perform a hash lookup
            if not model_id or not version_id:
                logger.warning(f"No model or version ID found for {lora_id}, performing hash lookup.")
                file_hash = await hash_file(os.path.join(lora_folder, f"{lora_id}.safetensors"))  # Assuming safetensors format
                version_info = await fetch_version_info(session, file_hash)

                if not version_info:
                    return web.json_response({"status": "error", "message": "Could not refresh LoRA"}, status=400)
            else:
                version_info = await fetch_version_info_by_id(session, version_id)

            # Update info.json with refreshed data
            # (Code to update the info.json with new data)

            return web.json_response({"status": "success", "data": info_data})

        except Exception as e:
            logger.info(f"Error refreshing LoRA: {str(e)}")
            return web.json_response({"status": "error", "message": str(e)}, status=500)
        
@PromptServer.instance.routes.post("/lora_sidebar/delete_lora")
async def delete_lora(request):
    data = await request.json()
    lora_id = data.get('id')
    
    if not lora_id:
        return web.json_response({"status": "error", "message": "No LoRA ID provided"}, status=400)
    
    lora_folder = os.path.join(LORA_DATA_DIR, lora_id)
    processed_loras_file = os.path.join(LORA_DATA_DIR, "processed_loras.json")
    
    try:
        # Remove the LoRA folder
        if os.path.exists(lora_folder):
            shutil.rmtree(lora_folder)
        
        # Update processed_loras.json
        if os.path.exists(processed_loras_file):
            with open(processed_loras_file, 'r', encoding="utf-8") as f:
                processed_loras = json.load(f)
            
            # Remove from processed list using the new format
            if 'loras' in processed_loras:
                processed_loras['loras'] = [
                    lora for lora in processed_loras['loras'] 
                    if lora.get('filename') != lora_id
                ]
            
            if 'favorites' in processed_loras:
                processed_loras['favorites'] = [f for f in processed_loras['favorites'] if f != lora_id]
            
            # Write updated data back to file
            with open(processed_loras_file, 'w', encoding="utf-8") as f:
                json.dump(processed_loras, f, indent=4, ensure_ascii=False)
        
        logger.info(f"Successfully deleted LoRA: {lora_id}")
        return web.json_response({"status": "success", "message": f"LoRA {lora_id} deleted successfully"})
    
    except Exception as e:
        logger.error(f"Error deleting LoRA {lora_id}: {str(e)}")
        return web.json_response({"status": "error", "message": f"Failed to delete LoRA: {str(e)}"}, status=500)


NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]