import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { $el } from "../../scripts/ui.js";

var debug = {
    enabled: false,
    log: function(...args) {
        if (this.enabled) {
            console.log(...args);
        }
    }
};

class LoraSidebar {
    constructor(app) {
        this.app = app;

        //session state changes
        this.sessionKey = 'loraSidebarSession';
        this.stateKey = 'loraSidebarState';
        this.loadingKey = 'loraSidebarContinuousLoadComplete';
        sessionStorage.setItem(this.loadingKey, 'false');
        this.isNewSession = this.checkNewSession();        ;
        this.state = this.isNewSession ? this.getDefaultState() : this.loadState();
        this.isFirstOpen = true; //session hack
        this.defaultCatState = app.ui.settings.getSettingValue("LoRA Sidebar.General.catState", "Expanded") === "Expanded";
        this.favState = app.ui.settings.getSettingValue("LoRA Sidebar.General.favState", true);
        this.loraData = [];
        this.filteredData = [];
        this.minSize = 100;
        this.maxSize = 400;
        this.loadingDelay = 800; // continuous loading delay in ms
        this.initialIndex = 500;
        this.batchSize = app.ui.settings.getSettingValue("LoRA Sidebar.General.batchSize", 500);
        this.nextStartIndex = this.initialIndex + 1;
        this.savedElementSize = app.ui.settings.getSettingValue("LoRA Sidebar.General.thumbnailSize", 125);
        this.elementSize = this.state.elementSize || this.savedElementSize;
        this.loadingIndicator = this.createLoadingIndicator();
        this.galleryContainer = this.createGalleryContainer();
        this.sizeSlider = this.createSizeSlider();
        this.progressBar = this.createProgressBar(); // Initialize progressBar
        this.loraSidebarWidth = 0;
        this.searchInput = this.createSearchInput();
        this.initialRenderComplete = false;
        this.savedModelFilter = app.ui.settings.getSettingValue("LoRA Sidebar.General.showModels", "All");
        this.sortModels = app.ui.settings.getSettingValue("LoRA Sidebar.General.sortModels", 'None');
        this.modelFilter = this.state.modelFilter || this.savedModelFilter;
        this.modelFilterDropdown = this.createModelFilterDropdown();
        this.currentSearchInput = this.state.searchTerm ? this.state.searchTerm.split(/\s+/) : [];
        this.PREDEFINED_TAGS = [
            "character", "style", "celebrity", "concept", "clothing", "poses", 
            "background", "tool", "buildings", "vehicle", "objects", "animal", "assets", "action"
        ];
        this.CUSTOM_TAGS = app.ui.settings.getSettingValue("LoRA Sidebar.General.customTags", "").split(',').map(tag => tag.trim().toLowerCase());
        debug.log("After loading CUSTOM_TAGS:", this.CUSTOM_TAGS);
        this.tagSource = app.ui.settings.getSettingValue("LoRA Sidebar.General.tagSource", "CivitAI");
        debug.log("Tag source:", this.tagSource);
        
        this.element = $el("div.lora-sidebar", [
            $el("div.lora-sidebar-content", [
                $el("h3", "LoRA Sidebar"),
                this.searchInput,
                this.modelFilterDropdown,
                this.sizeSlider,
                this.loadingIndicator,
                this.galleryContainer,
                this.progressBar
            ])
        ]);

        this.placeholderUrl = "/lora_sidebar/placeholder";

        this.showNSFW = app.ui.settings.getSettingValue("LoRA Sidebar.NSFW.hideNSFW", true);
        this.nsfwThreshold = app.ui.settings.getSettingValue("LoRA Sidebar.NSFW.nsfwLevel", 25);

        this.addStyles().catch(console.error);

        api.addEventListener("lora_process_progress", this.updateProgress.bind(this));
    }

    async addStyles() {
        try {
            const response = await fetch('./extensions/ComfyUI_LoRA_Sidebar/css/lora-sidebar.css');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const css = await response.text();
            const styleElement = document.createElement('style');
            styleElement.textContent = css;
            document.head.appendChild(styleElement);
        } catch (error) {
            console.error('Error loading LoRA Sidebar styles:', error);
        }
    }

    // session state stuff
    checkNewSession() {
        const lastSession = sessionStorage.getItem(this.sessionKey);
        const currentSession = Date.now().toString();
        sessionStorage.setItem(this.sessionKey, currentSession);
        return !lastSession || lastSession !== currentSession;
    }

    getDefaultState() {
        return {
            searchTerm: '',
            modelFilter: this.savedModelFilter,
            elementSize: this.savedElementSize,
            categoryStates: {},
        };
    }

    saveState() {
        sessionStorage.setItem(this.stateKey, JSON.stringify(this.state));
    }

    loadState() {
        const savedState = sessionStorage.getItem(this.stateKey);
        return savedState ? JSON.parse(savedState) : this.getDefaultState();
    }
    ///////

    getActiveTags() {
        return this.tagSource === 'CivitAI' ? this.PREDEFINED_TAGS : this.CUSTOM_TAGS;
    }

    setNSFWThreshold(threshold) {
        this.nsfwThreshold = threshold;
    }

    isNSFW(lora) {
        return (lora.nsfw && this.nsfwThreshold < 50) || (lora.nsfwLevel && lora.nsfwLevel > this.nsfwThreshold);
    }

    createSizeSlider() {
        this.sizeSlider = $el("input.lora-size-slider", {
            type: "range",
            min: this.minSize,
            max: this.maxSize,
            value: this.elementSize,
            oninput: (e) => {
                this.elementSize = parseInt(e.target.value);
                this.updateGalleryLayout();
            }
        });
        return this.sizeSlider;
    }

    createModelFilterDropdown() {
        const filterOptions = ['All', 'Pony', 'Flux', 'SDXL', 'SD 1.5', 'Custom + Other'];
        const dropdown = $el("select.model-filter-dropdown", {
            onchange: (e) => this.handleModelFilter(e.target.value)
        });
    
        filterOptions.forEach(option => {
            const optionElement = $el("option", { 
                value: option, 
                textContent: option,
                selected: option === this.state.modelFilter
            });
            dropdown.appendChild(optionElement);
        });
    
        return dropdown;
    }

    updateGalleryLayout() {
        const itemWidth = `${this.elementSize}px`;
    
        this.element.querySelectorAll('.lora-item').forEach(item => {
            item.style.width = itemWidth;
            // The height will be automatically set by the aspect-ratio in CSS
        });
    
        // Update the grid-template-columns for all lora-items-container
        this.element.querySelectorAll('.lora-items-container').forEach(container => {
            container.style.gridTemplateColumns = `repeat(auto-fill, minmax(${itemWidth}, 1fr))`;
        });
    }

    createSearchInput() {
        const searchContainer = $el("div.search-container", [
            $el("input.search-input", {
                type: "text",
                placeholder: "Search name, tags, model, etc.",
                value: this.state.searchTerm,
                oninput: (e) => this.handleSearch(e.target.value)
            }),
            $el("button.search-clear", {
                innerHTML: "&#x2715;",
                title: "Clear search",
                onclick: () => {
                    const searchInput = this.element.querySelector('.search-input');
                    searchInput.value = '';
                    this.handleSearch('');
                }
            })
        ]);
    
        return searchContainer;
    }

    createLoadingIndicator() {
        return $el("div.loading-indicator", {
            style: {
                display: "none",
                textAlign: "center",
                padding: "20px"
            }
        }, [
            $el("p", "Processing LoRAs..."),
            $el("progress")
        ]);
    }

    createGalleryContainer() {
        this.galleryContainer = $el("div.lora-gallery-container");
        return this.galleryContainer;
    }

    handleSearch(searchInput) {
        const newSearchInput = searchInput.toLowerCase().split(/\s+/).filter(term => term.length > 0);
        
        if (JSON.stringify(this.currentSearchInput) !== JSON.stringify(newSearchInput) ||
            searchInput === this.currentSearchInput.join(' ')) {
            
            this.currentSearchInput = newSearchInput;
            
            this.filteredData = this.loraData.filter(lora => {
                // NSFW filter - always apply if showNSFW is false
                if (!this.showNSFW && this.isNSFW(lora)) {
                    return false;
                }
    
                // Search term filter
                const matchesSearch = this.currentSearchInput.length === 0 || this.currentSearchInput.every(term => {
                    const nameMatch = lora.name && lora.name.toLowerCase().includes(term);
                    const tagMatch = Array.isArray(lora.tags) && lora.tags.some(tag => tag.toLowerCase().includes(term));
                    const trainedWordsMatch = Array.isArray(lora.trained_words) && lora.trained_words.some(word => word.toLowerCase().includes(term));
                    const baseModelMatch = lora.baseModel && lora.baseModel.toLowerCase().includes(term);
                    const subdirMatch = lora.subdir && lora.subdir.toLowerCase().includes(term);
                    const typeMatch = lora.type && lora.type.toLowerCase().includes(term);
    
                    return nameMatch || tagMatch || trainedWordsMatch || baseModelMatch || subdirMatch || typeMatch;
                });
    
                // Model filter
                const matchesModelFilter = this.modelFilter === 'All' || this.matchesModelFilter(lora, this.modelFilter);
    
                return matchesSearch && matchesModelFilter;
            });
        
            // Reset gallery and render first batch
            this.galleryContainer.innerHTML = '';
            this.renderLoraGallery(0, 500);
    
            this.state.searchTerm = searchInput;
            this.saveState();

            // Start continuous loading if not in 'None' sort mode
            if (this.sortModels !== 'None') {
                this.startContinuousLoading();
            }
        }
    }

    startContinuousLoading() {
        if (this.sortModels === 'None') {
            return; // Exit early if sort is set to None
        }

        if (!this.initialRenderComplete) {
            // If initial render isn't complete, check again after 500ms
            setTimeout(() => this.startContinuousLoading(), 500);
            debug.log("Initial render not done, waiting...");
            return;
        }
    
        if (this.isLoadingContinuously) {
            debug.log("Still loading, ignoring call...");
            return; // Prevent multiple concurrent loading processes
        }

        const isLoadComplete = sessionStorage.getItem(this.loadingKey) === 'true';
        debug.log(isLoadComplete);
    
        if (isLoadComplete) {
            debug.log("Continuous load already complete for this session, skipping load.");
            const remainingItems = this.filteredData.length - this.initialIndex;
            if (remainingItems > 0) {
                debug.log(`Rendering ${remainingItems} remaining items`);
                this.renderLoraGallery(this.initialIndex + 1, remainingItems);
                this.sortCategories();
            }
            return;
        }

        let previousTotalItemCount = this.initialIndex;
        let sameCountIterations = 0;
        const batchSize = this.batchSize;
    
        setTimeout(() => {
            this.isLoadingContinuously = true;
            debug.log(isLoadComplete);
    
            const loadMoreItems = () => {
                const visibleItemCount = this.galleryContainer.querySelectorAll('.lora-item:not(.hidden)').length;
                const closedItemCount = this.countItemsInClosedCategories();
                const currentTotalItemCount = visibleItemCount + closedItemCount;
                const favoritesCount = this.filteredData.filter(lora => lora.favorite).length;
                const totalItems = this.filteredData.length;
                const remainingItems = totalItems - this.nextStartIndex - favoritesCount;
    
                debug.log(`Visible items: ${visibleItemCount}, Closed items: ${closedItemCount}, Favorites: ${favoritesCount}, Total: ${totalItems}, Next start index: ${this.nextStartIndex}`);
    
                if (currentTotalItemCount === previousTotalItemCount && remainingItems < batchSize) {
                    sameCountIterations++;
                } else {
                    sameCountIterations = 0;
                }
    
                if (remainingItems > 0 && (sameCountIterations < 3 || remainingItems >= batchSize)) {
                    const itemsToLoad = Math.min(remainingItems, batchSize);
                    debug.log(`Loading ${itemsToLoad} more items starting from index ${this.nextStartIndex}`);
                    
                    this.renderLoraGallery(this.nextStartIndex, itemsToLoad);
                    this.sortCategories();
    
                    previousTotalItemCount = currentTotalItemCount;
                    this.nextStartIndex += itemsToLoad;
    
                    setTimeout(() => {
                        this.isLoadingContinuously = false;
                        this.startContinuousLoading();
                    }, this.loadingDelay);
                } else {
                    debug.log("All items loaded or loading stopped due to no progress");
                    this.isLoadingContinuously = false;
                    sessionStorage.setItem(this.loadingKey, 'true');
                    this.nextStartIndex = this.initialIndex + 1;
                }
            };
    
            loadMoreItems();
        }, 1200); // short delay for data
    }

    sortCategories() {
        const categories = Array.from(this.galleryContainer.querySelectorAll('.lora-category'));
        categories.sort((a, b) => {
            if (a.getAttribute('data-category') === 'Favorites') return -1;
            if (b.getAttribute('data-category') === 'Favorites') return 1;
            return a.getAttribute('data-category').localeCompare(b.getAttribute('data-category'));
        });
        categories.forEach(category => this.galleryContainer.appendChild(category));
    }

    countItemsInClosedCategories() {
        let count = 0;
        const categories = this.galleryContainer.querySelectorAll('.lora-category');
        categories.forEach(category => {
            const lorasContainer = category.querySelector('.lora-items-container');
            if (lorasContainer.style.display === 'none') {
                count += lorasContainer.children.length;
            }
        });
        return count;
    }

    getCategoryItems(categoryName) {
        const activeTags = this.getActiveTags();
        if (categoryName === "Favorites") {
            return this.filteredData.filter(lora => lora.favorite);
        } else if (this.sortModels === 'Subdir') {
            return this.filteredData.filter(lora => {
                const parts = lora.subdir ? lora.subdir.split('\\') : [];
                return parts[parts.length - 1] === categoryName || (categoryName === "Unsorted" && !lora.subdir);
            });
        } else if (this.sortModels === 'Tags') {
            if (activeTags.includes(categoryName)) {
                return this.filteredData.filter(lora => 
                    lora.tags && lora.tags.includes(categoryName)
                );
            } else if (categoryName === 'Unsorted') {
                return this.filteredData.filter(lora => 
                    !lora.tags || !activeTags.some(tag => lora.tags.includes(tag))
                );
            }
        }
        return [];
    }
        
    matchesModelFilter(lora, filter) {
        const baseModel = (lora.baseModel || '').toLowerCase();
        switch (filter) {
            case 'Pony':
                return baseModel.includes('pony');
            case 'Flux':
                return baseModel.includes('flux');
            case 'SDXL':
                return baseModel.includes('sdxl');
            case 'SD 1.5':
                return baseModel.includes('sd') && baseModel.includes('1.5');
            case 'Custom + Other':
                return !['pony', 'flux', 'sdxl', 'sd', '1.5'].some(model => baseModel.includes(model));
            default:
                return true;
        }
    }
    
    handleModelFilter(filterValue) {
        this.modelFilter = filterValue;
        this.state.modelFilter = filterValue;
        this.handleSearch(this.state.searchTerm);
        this.saveState();
    }

    async checkUnprocessedLoras() {
        debug.log("Checking for unprocessed LoRAs...");
        try {
            const response = await api.fetchApi('/lora_sidebar/unprocessed_count');
            debug.log("Response received:", response);
            if (response.ok) {
                const data = await response.json();
                debug.log("Unprocessed LoRAs data:", data);
                return data.unprocessed_count;
            } else {
                console.error("Error response:", response.status, response.statusText);
            }
        } catch (error) {
            console.error("Error checking unprocessed LoRAs:", error);
        }
        return 0;
    }

    showUnprocessedLorasPopup(count) {
        return new Promise(async (resolve) => {
            // First, check if processing is already running
            let isProcessing = false;
            try {
                const processingResponse = await fetch('/lora_sidebar/is_processing');
                if (processingResponse.ok) {
                    const processingData = await processingResponse.json();
                    isProcessing = processingData.is_processing;
                }
            } catch (error) {
                console.error("Error checking processing status:", error);
            }

            // If processing is already in progress, don't show the popup
            if (isProcessing) {
                debug.log("Processing already in progress, skipping prompt.");
                resolve(false);  // Automatically resolve as "no processing"
                return;
            }

            // Fetch the estimate from the backend
            let estimatedTimeStr = "Calculating...";
            try {
                const response = await fetch(`/lora_sidebar/estimate?count=${count}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                const { estimated_time_minutes } = data;
                
                // Use the estimated_time_minutes directly as it already includes the units
                estimatedTimeStr = `${estimated_time_minutes}`;
            } catch (error) {
                console.error("Error fetching estimate:", error);
                estimatedTimeStr = "Unavailable";
            }

            const popup = $el("div.lora-popup", {
                style: {
                    position: "fixed",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    backgroundColor: "#333",
                    padding: "20px",
                    borderRadius: "10px",
                    boxShadow: "0 0 10px rgba(0,0,0,0.5)",
                    zIndex: "1000",
                    color: "#ccc",
                    maxWidth: "400px",
                    textAlign: "center"
                }
            }, [
                $el("h3", "Process LoRAs"),
                $el("p", `Found ${count} LoRAs to process.`),
                $el("p", `Estimated processing time: ${estimatedTimeStr}.`),
                $el("p", "This process can take a lot of time with large amounts of loras. (This is for your protection so CivitAI doesn't ban your IP!) If you have local metadata, it will be used for processing and speed things up considerably. (Minutes vs Hours for large data sets)"),
                $el("p", "You are free to close the sidebar and use Comfy normally while this processes. If you need to quit, progress is saved and can be resumed later."),
                $el("p", "If this is asking to process older LoRA files again, it means I had to make a data change. (Sorry) You can Cancel this process for now but you won't have new features (or LoRAs) until you hit OK."),
                $el("div", {
                    style: {
                        display: "flex",
                        justifyContent: "space-around",
                        marginTop: "20px"
                    }
                }, [
                    $el("button", {
                        textContent: "OK",
                        onclick: () => {
                            document.body.removeChild(popup);
                            resolve(true);
                        },
                        style: {
                            padding: "10px 20px",
                            cursor: "pointer",
                            backgroundColor: "#4CAF50",
                            color: "white",
                            border: "none",
                            borderRadius: "5px"
                        }
                    }),
                    $el("button", {
                        textContent: "Cancel",
                        onclick: () => {
                            document.body.removeChild(popup);
                            resolve(false);
                        },
                        style: {
                            padding: "10px 20px",
                            cursor: "pointer",
                            backgroundColor: "#f44336",
                            color: "white",
                            border: "none",
                            borderRadius: "5px"
                        }
                    })
                ])
            ]);
            document.body.appendChild(popup);
        });
    }

    createProgressBar() {
        const container = document.createElement('div');
        container.style.display = 'none';
        container.style.width = '100%';
        container.style.marginTop = '10px';

        const progress = document.createElement('progress');
        progress.style.width = '100%';
        progress.max = 100;
        progress.value = 0;

        // counter
        const progressText = document.createElement('div');
        progressText.style.textAlign = 'center';
        progressText.style.marginTop = '5px';
        progressText.style.fontSize = '12px';
        progressText.style.color = '#666';

        container.appendChild(progress);
        container.appendChild(progressText);
        return container;
    }

    updateProgress(event) {
        const { progress, completed, total } = event.detail;
        this.progressBar.style.display = 'block';
        const progressBar = this.progressBar.querySelector('progress');
        const progressText = this.progressBar.querySelector('div');
        
        progressBar.value = progress;
        progressText.textContent = `Processing: ${completed}/${total}`;
    }

    async processLoras() {
        this.progressBar.style.display = 'block';
        try {
            const response = await api.fetchApi('/lora_sidebar/process');
            if (response.ok) {
                const result = await response.json();
                debug.log("LoRAs processed successfully", result);
            } else {
                console.error("Error processing LoRAs:", response.status, response.statusText);
            }
        } catch (error) {
            console.error("Error processing LoRAs:", error);
        } finally {
            this.progressBar.style.display = 'none';
        }
    }

    async toggleFavorite(lora) {
        try {
            const response = await api.fetchApi('/lora_sidebar/toggle_favorite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: lora.id })
            });
    
            if (response.ok) {
                const result = await response.json();
                
                // Update the favorite status in both filteredData and loraData
                const updateLoraInArray = (array) => {
                    const loraInArray = array.find(l => l.id === lora.id);
                    if (loraInArray) {
                        loraInArray.favorite = result.favorite;
                    }
                };
    
                updateLoraInArray(this.filteredData);
                updateLoraInArray(this.loraData);
    
                this.renderLoraGallery();
                this.showToast("success", "Favorite Updated", `${lora.name} has been ${result.favorite ? 'added to' : 'removed from'} favorites.`);
            } else {
                throw new Error('Failed to update favorite');
            }
        } catch (error) {
            console.error("Error toggling favorite:", error);
            this.showToast("error", "Update Failed", `Failed to update favorite status for ${lora.name}.`);
        }
    }

    async loadLoraData(offset = 0, limit = this.batchSize) {
        try {
            const response = await api.fetchApi(`/lora_sidebar/data?offset=${offset}&limit=${limit}`);
            if (response.ok) {
                const data = await response.json();
                if (data && data.loras) {
                    const favorites = data.favorites || [];

                    // Use a Set to keep track of unique LoRA IDs
                    const existingLoraIds = new Set(this.loraData.map(lora => lora.id));

                    const newLoras = data.loras.filter(lora => !existingLoraIds.has(lora.id))
                    .map(lora => ({
                        ...lora,
                        favorite: favorites.includes(lora.id)
                    }));
                    
                    if (offset === 0) {
                        this.loraData = newLoras;
                        this.filteredData = this.loraData;
                        this.renderLoraGallery(0, 500); // Initial render
                    } else {
                        this.loraData = [...this.loraData, ...newLoras];
                        this.filteredData = this.loraData;
                        // No re-render here, scrolling will trigger rendering as needed
                    }
                    
                    if (data.hasMore) {
                        // Load next chunk after a short delay
                        setTimeout(() => this.loadLoraData(offset + limit, limit), 100);
                    }
                }
            }
        } catch (error) {
            console.error("Error loading LoRA data:", error);
        }
    }

    renderLoraGallery(startIndex = 0, count = 500) {
        if (startIndex === 0) {
            this.galleryContainer.innerHTML = '';
        }

        debug.log(`renderLoraGallery called with startIndex: ${startIndex}, count: ${count}`);
        debug.log(`Current filteredData length: ${this.filteredData.length}`);
    
        // Render Favorites
        const favorites = this.filteredData.filter(lora => lora.favorite);
        if (favorites.length > 0 && startIndex === 0) {
            const favoritesCategory = this.createCategoryElement("Favorites", favorites);
            this.galleryContainer.appendChild(favoritesCategory);
        }
    
        // Render LoRAs (excluding favorites)
        const nonFavorites = this.filteredData.filter(lora => !lora.favorite);
        const endIndex = Math.min(startIndex + count, nonFavorites.length);
        const lorasToRender = nonFavorites.slice(startIndex, endIndex);
    
        if (this.sortModels === 'Subdir') {
            const categories = {};
            lorasToRender.forEach(lora => {
                // NSFW check
                if (this.isNSFW(lora) && !this.showNSFW) {
                    return;
                }

                let category = 'Unsorted';
                if (lora.subdir) {
                    const parts = lora.subdir.split('\\');
                    category = parts[parts.length - 1];
                }
                if (!categories[category]) {
                    categories[category] = [];
                }
                categories[category].push(lora);
            });
    
            Object.entries(categories).forEach(([category, loras]) => {
                if (loras.length > 0) {
                    let categoryElement = this.galleryContainer.querySelector(`.lora-category[data-category="${category}"]`);
                    if (!categoryElement) {
                        categoryElement = this.createCategoryElement(category, loras);
                        this.galleryContainer.appendChild(categoryElement);
                    } else {
                        // Only show if the category is expanded
                        const lorasContainer = categoryElement.querySelector('.lora-items-container');
                        const isExpanded = window.getComputedStyle(lorasContainer).display !== 'none';
                        this.createCategoryElement(category, loras, true); // Always create elements, even if category is closed
                        if (!isExpanded) {
                            lorasContainer.style.display = 'none'; // Ensure the container stays hidden if it was closed
                        }
                    }
                }
            });

            this.sortCategories();

        } else if (this.sortModels === 'Tags') {
            const activeTags = this.getActiveTags();
            const categories = {};
            activeTags.forEach(tag => {
                categories[tag] = [];
            });
            categories['Unsorted'] = [];
    
            lorasToRender.forEach(lora => {
                // NSFW check
                if (this.isNSFW(lora) && !this.showNSFW) {
                    return;
                }

                let categorized = false;
                for (const tag of activeTags) {
                    if (lora.tags && lora.tags.includes(tag)) {
                        categories[tag].push(lora);
                        categorized = true;
                        break; // Stop after first matching tag
                    }
                }
                if (!categorized) {
                    categories['Unsorted'].push(lora);
                }
            });
    
            Object.entries(categories).forEach(([category, loras]) => {
                if (loras.length > 0) { // Only create categories that have LoRAs
                    let categoryElement = this.galleryContainer.querySelector(`.lora-category[data-category="${category}"]`);
                    if (!categoryElement) {
                        categoryElement = this.createCategoryElement(category, loras);
                        this.galleryContainer.appendChild(categoryElement);
                    } else {
                        const lorasContainer = categoryElement.querySelector('.lora-items-container');
                        const isExpanded = window.getComputedStyle(lorasContainer).display !== 'none';
                        this.createCategoryElement(category, loras, true); // Always create elements, even if category is closed
                        if (!isExpanded) {
                            lorasContainer.style.display = 'none'; // Ensure the container stays hidden if it was closed
                        }
                    }
                }
            });

            this.sortCategories();

        } else {
            // Original rendering logic for 'None' sorting option
            let allLorasCategory = this.galleryContainer.querySelector('.lora-category[data-category="All LoRAs"]');
            if (!allLorasCategory || startIndex === 0) {
                allLorasCategory = this.createCategoryElement("All LoRAs", lorasToRender);
                this.galleryContainer.appendChild(allLorasCategory);
            } else {
                this.createCategoryElement("All LoRAs", lorasToRender, true);
            }
        }
    
        this.updateGalleryLayout();
        this.initialRenderComplete = true;
    }

    setupScrollHandler() {
        debug.log("Setting up scroll handler");
    
        // Use a MutationObserver to wait for the container to appear
        const observer = new MutationObserver(() => {
            const sidebarContentContainer = document.querySelector('.sidebar-content-container');
            
            if (sidebarContentContainer) {
                debug.log("Sidebar content container found, attaching scroll handler");
    
                // Attach scroll listener to the dynamically created container
                sidebarContentContainer.addEventListener('scroll', this.handleScroll.bind(this));
    
                // Stop observing once the element is found and handled
                observer.disconnect();
            }
        });
    
        // Observe the entire document for changes
        observer.observe(document.body, { childList: true, subtree: true });
    }
    
    handleScroll() {   
        const sidebarContentContainer = document.querySelector('.sidebar-content-container');
        
        if (this.isNearBottom(sidebarContentContainer) && !this.isAllContentLoaded()) {
            debug.log('Near bottom, loading more items');
            if (this.sortModels === 'None') {
                const currentItemCount = this.galleryContainer.querySelectorAll('.lora-item').length;
                const remainingItems = this.filteredData.length - currentItemCount;
                
                if (remainingItems > 0) {
                    const itemsToLoad = Math.min(remainingItems, 500);
                    this.renderLoraGallery(currentItemCount, itemsToLoad);
                    debug.log('Handle Scroll calling RenderLora');
                }
            } else {
                // For categorized views, trigger continuous loading
                this.startContinuousLoading();
            }
        }
    }
    
    isNearBottom(container) {
        const scrollPosition = container.scrollTop + container.clientHeight;
        const totalHeight = container.scrollHeight;
    
        const scrollThreshold = 0.9; // 90% of the way down
        return scrollPosition / totalHeight > scrollThreshold;
    }

    isAllContentLoaded() {
        // If sort order is not 'None', assume content is always loading
        if (this.sortModels !== 'None') {
            return true;
        }
    
        const currentItemCount = this.galleryContainer.querySelectorAll('.lora-item').length;
        const filteredDataCount = this.filteredData.length;
        const favoritesCount = this.filteredData.filter(lora => lora.favorite).length;
        debug.log(`Items loaded: ${currentItemCount}, Total filtered items: ${filteredDataCount}, Favorites: ${favoritesCount}`);
        
        return currentItemCount + favoritesCount >= filteredDataCount && currentItemCount >= favoritesCount;
    }
    
    createCategoryElement(categoryName, loras, appendToExisting = false) {
        let categoryContainer;
        
        if (appendToExisting) {
            categoryContainer = this.galleryContainer.querySelector(`.lora-category[data-category="${categoryName}"]`);
            
            if (!categoryContainer) {
                categoryContainer = $el("div.lora-category");
                
                // Manually set the data-category attribute
                categoryContainer.setAttribute('data-category', categoryName);
                
                this.galleryContainer.appendChild(categoryContainer);
                
            }
        } else {
            categoryContainer = $el("div.lora-category");
            
            // Manually set the data-category attribute
            categoryContainer.setAttribute('data-category', categoryName);

            this.galleryContainer.appendChild(categoryContainer);
            
        }
    
        let header = categoryContainer.querySelector('.category-header');
        if (!header) {
            // For Favorites category, use favState if enabled, otherwise use normal state logic
            const isFavorites = categoryName === "Favorites";
            let isExpanded;
            
            if (isFavorites && this.favState) {
                isExpanded = true; // Always expand Favorites if favState is true
            } else {
                isExpanded = this.state.categoryStates[categoryName] !== undefined 
                    ? this.state.categoryStates[categoryName] 
                    : this.defaultCatState;
            }
            
            header = $el("div.category-header", {}, [
                $el("h3.category-title", {}, [categoryName]),
                $el("span.category-toggle", {}, [isExpanded ? "▼" : "▶"])
            ]);
            
            header.addEventListener('click', () => this.toggleCategory(categoryName));
            
            categoryContainer.appendChild(header);
        }
    
        let lorasContainer = categoryContainer.querySelector('.lora-items-container');
        if (!lorasContainer) {
            lorasContainer = $el("div.lora-items-container");
            
            // fav check
            const isFavorites = categoryName === "Favorites";
            let isExpanded;
            
            if (isFavorites && this.favState) {
                isExpanded = true;
            } else {
                isExpanded = this.state.categoryStates[categoryName] !== undefined 
                    ? this.state.categoryStates[categoryName] 
                    : this.defaultCatState;
            }
            
            lorasContainer.style.display = isExpanded ? 'grid' : 'none';
            categoryContainer.appendChild(lorasContainer);
    
            // Only create LORA elements if the category is expanded
            if (isExpanded) {
                this.createLoraElementsForCategory(lorasContainer, loras);
            } else {
                // Store loras data for later creation
                lorasContainer.dataset.pendingLoras = JSON.stringify(loras.map(lora => lora.id));
            }
        } else if (appendToExisting) {
            // If appending to existing category, check if it's expanded
            const isExpanded = window.getComputedStyle(lorasContainer).display !== 'none';
            if (isExpanded) {
                this.createLoraElementsForCategory(lorasContainer, loras);
            } else {
                // Append to pending loras
                const pendingLoras = JSON.parse(lorasContainer.dataset.pendingLoras || '[]');
                pendingLoras.push(...loras.map(lora => lora.id));
                lorasContainer.dataset.pendingLoras = JSON.stringify(pendingLoras);
            }
        }
    
        return categoryContainer;
    }

    createLoraElementsForCategory(container, loras) {
        loras.forEach(lora => {
            const loraElement = this.createLoraElement(lora);
            if (loraElement) {
                container.appendChild(loraElement);
            }
        });
    }
    
    toggleCategory(categoryName) {
        debug.log("Attempting to toggle category:", categoryName);
    
        // Retrieve all categories
        const categories = this.galleryContainer.querySelectorAll('.lora-category');
        
        debug.log("Available categories:");
        categories.forEach(cat => debug.log(cat.getAttribute('data-category'))); // Use getAttribute
    
        // Find the category with the exact data-category match
        const category = Array.from(categories).find(cat => cat.getAttribute('data-category') === categoryName);
        
        debug.log("Category element found:", category);
        
        if (category) {
            const content = category.querySelector('.lora-items-container');
            debug.log("Content element found:", content);
            
            const toggle = category.querySelector('.category-toggle');
            debug.log("Toggle element found:", toggle);
            
            if (content && toggle) {
                const isVisible = window.getComputedStyle(content).display !== 'none';
                debug.log("Is content visible?", isVisible);
                
                if (isVisible) {
                    content.style.display = 'none';
                    toggle.textContent = '▶';
                    this.state.categoryStates[categoryName] = false;
                } else {
                    content.style.display = 'grid';
                    toggle.textContent = '▼';
                    this.state.categoryStates[categoryName] = true;

                    // Create LORA elements if they don't exist
                    if (content.children.length === 0 && content.dataset.pendingLoras) {
                        const pendingLoraIds = JSON.parse(content.dataset.pendingLoras);
                        const loras = pendingLoraIds.map(id => this.loraData.find(lora => lora.id === id)).filter(Boolean);
                        this.createLoraElementsForCategory(content, loras);
                        delete content.dataset.pendingLoras;
                    }
                }

                this.saveState();
                this.updateGalleryLayout();
                debug.log("Toggled category:", categoryName, "New state:", content.style.display);
            } else {
                console.error("Content or toggle element not found within category");
            }
        } else {
            console.error("Category element not found");
        }
    }
    

    getFontSizeBasedOnLength(text) {
        const length = text.length;
        if (length <= 10) {
            return "16px"; // Largest font size for short text
        } else if (length <= 20) {
            return "14px";
        } else if (length <= 30) {
            return "12px";
        } else {
            return "10px"; // Minimum font size with ellipsis
        }
    }

    createLoraElement(lora, forceRefresh = false) {
        const container = $el("div.lora-item");
        const previewUrl = forceRefresh 
        ? `/lora_sidebar/preview/${encodeURIComponent(lora.id)}?cb=${Date.now()}`
        : `/lora_sidebar/preview/${encodeURIComponent(lora.id)}`;
        
        let isVideo = false;
        let previewElement;
        
        const createPreviewElement = (tryVideo = false) => {
            isVideo = tryVideo;
            const elementType = isVideo ? "video" : "img";
            const element = $el(elementType, {
                src: previewUrl,
                alt: lora.name,
                draggable: true,
                ...(isVideo && { loop: true, muted: true }),
                ondragstart: (e) => {
                    const dragData = JSON.stringify({
                        type: "comfy-lora",
                        id: lora.id
                    });
                    e.dataTransfer.setData("application/json", dragData);
                    this.handleDragStart(e);
                },
                onerror: (e) => {
                    if (!e.target.hasAttribute('data-error-handled')) {
                        e.target.setAttribute('data-error-handled', 'true');
                        if (!isVideo) {
                            const videoElement = createPreviewElement(true);
                            container.replaceChild(videoElement, previewElement);
                            previewElement = videoElement;
                        } else {
                            debug.log(`Using placeholder for ${lora.name}`);
                            const imgElement = $el("img", {
                                src: this.placeholderUrl,
                                alt: lora.name,
                                draggable: true
                            });
                            container.replaceChild(imgElement, previewElement);
                            previewElement = imgElement;
                            isVideo = false;
                        }
                    }
                },
                onloadedmetadata: isVideo ? (e) => {
                    if (e.target.videoWidth === 0 && e.target.videoHeight === 0) {
                        debug.log(`Invalid video for ${lora.name}, using placeholder`);
                        const imgElement = $el("img", {
                            src: this.placeholderUrl,
                            alt: lora.name,
                            draggable: true
                        });
                        container.replaceChild(imgElement, previewElement);
                        previewElement = imgElement;
                        isVideo = false;
                    }
                } : null
            });
            return element;
        };
    
        previewElement = createPreviewElement();
    
        const overlay = $el("div.lora-overlay", {
            draggable: true,
            ondragstart: (e) => {
                e.stopPropagation();
                const dragData = JSON.stringify({
                    type: "comfy-lora",
                    id: lora.id
                });
                debug.log("Setting drag data from overlay:", dragData);
                e.dataTransfer.setData("application/json", dragData);
                this.handleDragStart(e);
            }
        });
    
        const buttonContainer = $el("div.lora-buttons", [
            this.createButton("📋", "Copy", () => this.copyTrainedWords(lora)),
            this.createButton("🔄", "Refresh", () => this.refreshLora(lora)),
            this.createButton(lora.favorite ? "★" : "☆", "Favorite", () => this.toggleFavorite(lora)),
            this.createButton("ℹ️", "Info", (e) => this.showLoraInfo(lora, e.target)),
        ]);
    
        const fontSize = this.getFontSizeBasedOnLength(lora.name);
    
        const titleContainer = $el("div.lora-title", [
            $el("h4", { 
                textContent: lora.name,
                style: { fontSize: fontSize }
            })
        ]);
    
        overlay.appendChild(buttonContainer);
        overlay.appendChild(titleContainer);

        if (this.isNSFW(lora) && this.nsfwThreshold < 50) {
            container.classList.add('nsfw');
            const nsfwLabel = $el("span.nsfw-label", {
                textContent: lora.nsfw ? "NSFW" : `NSFW Level: ${lora.nsfwLevel}`
            });
            container.appendChild(nsfwLabel);
        }
    
        // Add hover events to the overlay for video control
        overlay.addEventListener('mouseenter', () => {
            if (isVideo && previewElement instanceof HTMLVideoElement) {
                previewElement.play().then(() => {
                }).catch(error => {
                    console.error(`Error playing video for ${lora.name}:`, error);
                });
            }
        });
        
        overlay.addEventListener('mouseleave', () => {
            if (isVideo && previewElement instanceof HTMLVideoElement) {
                previewElement.pause();
                previewElement.currentTime = 0;
            }
        });
    
        container.appendChild(previewElement);
        container.appendChild(overlay);
    
        return container;
    }
    
    createButton(icon, tooltip, onClick) {
        return $el("button", {
            textContent: icon,
            title: tooltip,
            onclick: onClick
        });
    }

    showToast(severity, summary, detail, life = 3000) {
        this.app.extensionManager.toast.add({ severity, summary, detail, life });
    }

    copyTrainedWords(lora) {
        if (lora.trained_words && lora.trained_words.length > 0) {
            const trainedWordsText = lora.trained_words.join(', ');
            navigator.clipboard.writeText(trainedWordsText).then(() => {
                this.showToast("success", "Copied", "Trained words copied to clipboard.");
            }).catch(err => {
                console.error('Failed to copy trained words:', err);
                this.showToast("error", "Copy Failed", "Failed to copy trained words to clipboard.");
            });
        } else {
            this.showToast("info", "No Trained Words", "No trained words exist for this LoRA.");
        }
    }

    async refreshLora(lora) {
        if (!lora || !lora.id) {
            console.error("Invalid LoRA object or missing ID:", lora);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "Refresh Failed",
                detail: "Invalid LoRA data. Please try reloading the page.",
                life: 5000
            });
            return;
        }
    
        try {
            // First, call /refresh/{lora_id} to get versionId if it doesn't exist
            let versionId = lora.versionId;
            if (!versionId) {
                debug.log(`No versionId for LoRA ${lora.name}, performing hash lookup.`);
                const idResponse = await api.fetchApi(`/lora_sidebar/refresh/${lora.id}`, {
                    method: 'POST'
                });
    
                if (!idResponse.ok) {
                    throw new Error(`Failed to perform hash lookup for LoRA: ${lora.name}`);
                }
    
                const idResult = await idResponse.json();
                if (idResult.status === 'success' && idResult.data && idResult.data.versionId) {
                    versionId = idResult.data.versionId;
                    debug.log(`Found versionId ${versionId} for LoRA ${lora.name}`);
                } else {
                    throw new Error(`Hash lookup failed or no versionId found for LoRA: ${lora.name}`);
                }
            }
    
            // Now that we have the versionId, proceed to refresh with /refresh/{version_id}
            debug.log(`Refreshing LoRA with version ID: ${versionId}`);
            const response = await api.fetchApi(`/lora_sidebar/refresh/${versionId}`, {
                method: 'POST'
            });
    
            if (!response.ok) {
                throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
            }
    
            const result = await response.json();
            debug.log("Refresh Result:", result);
    
            if (result.status === 'success') {
                if (result.data) {
                    debug.log("Updated LoRA Data:", result.data);
                    const updatedLoraData = result.data;
                    const index = this.loraData.findIndex(l => l.versionId === versionId || l.id === lora.id);
                    if (index !== -1) {
                        // Merge existing LoRA with updated data to preserve 'id'
                        this.loraData[index] = { ...this.loraData[index], ...updatedLoraData };
                        debug.log("Merged LoRA Data:", this.loraData[index]);
                        this.filteredData = [...this.loraData];
                        this.renderLoraGallery();
                        app.extensionManager.toast.add({
                            severity: "success",
                            summary: "LoRA Refreshed",
                            detail: `${updatedLoraData.name} has been successfully refreshed.`,
                            life: 3000
                        });
                    } else {
                        throw new Error("LoRA not found in local data");
                    }
                } else {
                    app.extensionManager.toast.add({
                        severity: "info",
                        summary: "No Update Needed",
                        detail: `No updates were required for ${lora.name}.`,
                        life: 3000
                    });
                }
            } else {
                debug.log("Refresh Failed:", result);
                throw new Error(result.message || 'Failed to refresh LoRA');
            }
        } catch (error) {
            console.error("Error refreshing LoRA:", error);
            app.extensionManager.toast.add({
                severity: "error",
                summary: "Refresh Failed",
                detail: `Failed to refresh ${lora.name}. ${error.message}`,
                life: 5000
            });
        }
    }
    

    setupCanvasDropHandling() {
        const canvas = app.canvas.canvas;
        let currentDragData = null;
        let isDragging = false;
    
        // Make this available to other methods
        this.handleDragStart = (e) => {
            if (e.dataTransfer.types.includes('application/json')) {
                currentDragData = e.dataTransfer.getData('application/json');
                isDragging = true;
                debug.log("Drag started, cached data");
            }
        };
    
        const handleDrop = (e) => {
            debug.log("Drop handler called from:", e.target);
            
            let data = e.dataTransfer?.getData('application/json') || currentDragData;
            if (!data) {
                debug.log("No drop data available");
                return;
            }
    
            // Early check to ignore non-comfy-lora objects
            try {
                const dragData = JSON.parse(data);
                if (dragData.type !== "comfy-lora") {
                    debug.log("Non-comfy-lora object dropped, ignoring.");
                    return;  // Ignore and allow default behavior
                }
            } catch (error) {
                debug.log("Error parsing drop data, ignoring.", error);
                return;  // Ignore and allow default behavior
            }
    
            // If we reach here, it's a "comfy-lora" object
            debug.log("Comfy-lora object dropped, processing.");
    
            const canvasRect = canvas.getBoundingClientRect();
            const dropX = (e.clientX - canvasRect.left) / app.canvas.ds.scale - app.canvas.ds.offset[0];
            const dropY = (e.clientY - canvasRect.top) / app.canvas.ds.scale - app.canvas.ds.offset[1];
    
            try {
                const dragData = JSON.parse(data);
                if (dragData.type === "comfy-lora") {
                    const loraData = this.loraData.find(l => l.id === dragData.id);
                    if (!loraData) {
                        debug.log("Failed to find LoRA data for id:", dragData.id);
                        return;
                    }
    
                    const nodeData = {
                        name: loraData.name,
                        path: loraData.subdir || "",
                        filename: loraData.filename
                    };
    
                    let attempts = 0;
                    const maxAttempts = 3;
                    
                    const tryCreateNode = () => {
                        attempts++;
                        debug.log(`Attempt ${attempts} to create/update node`);
    
                        requestAnimationFrame(() => {
                            try {
                                const node = app.graph.getNodeOnPos(dropX, dropY);
                                
                                if (node && node.type === "LoraLoader") {
                                    this.updateLoraNode(node, nodeData);
                                    debug.log("Successfully updated node");
                                } else {
                                    this.createLoraNode(nodeData, dropX, dropY);
                                    debug.log("Successfully created node");
                                }
                                
                                app.graph.setDirtyCanvas(true, true);
                            } catch (err) {
                                debug.log(`Attempt ${attempts} failed:`, err);
                                if (attempts < maxAttempts) {
                                    setTimeout(tryCreateNode, attempts * 100);
                                }
                            }
                        });
                    };
    
                    tryCreateNode();
                }
            } catch (error) {
                debug.log("Error processing comfy-lora dropped data:", error);
            } finally {
                currentDragData = null;
                isDragging = false;
            }
        };
    
        canvas.addEventListener('dragover', (e) => {
            if (e.dataTransfer.types.includes('application/json')) {
                e.preventDefault();  // Enable drop events to fire
            }
        }, { passive: false });
    
        canvas.addEventListener('drop', handleDrop);
        canvas.addEventListener('dragenter', (e) => e.preventDefault());
        canvas.addEventListener('dragleave', (e) => e.preventDefault());
    
        document.addEventListener('drop', (e) => {
            if (isDragging) {
                handleDrop(e);
            }
        });
    
        document.addEventListener('dragend', (e) => {
            if (isDragging) {
                debug.log("Dragend caught with active drag");
                handleDrop(e);
            }
        });
    }
    
    
    createLoraNode(loraData, x, y) {
        const node = LiteGraph.createNode("LoraLoader");
        node.pos = [x, y];
        
        // Set node title
        node.title = `Lora - ${loraData.name}`;
        
        // Set widget values
        for (const widget of node.widgets) {
            if (widget.name === "lora_name") {
                widget.value = `${loraData.path}${loraData.path ? '\\' : ''}${loraData.filename}`;
            }
        }
        
        // Add the node to the graph
        app.graph.add(node);
        
        // Ensure the canvas is updated
        app.graph.setDirtyCanvas(true, true);
    }

    updateLoraNode(node, loraData) {
        // Update the node title
        node.title = `Lora - ${loraData.name}`;
        
        // Update widget values
        for (const widget of node.widgets) {
            if (widget.name === "lora_name") {
                widget.value = `${loraData.path}${loraData.path ? '\\' : ''}${loraData.filename}`;
            }
        }
        
        // Ensure the canvas is updated
        app.graph.setDirtyCanvas(true, true);
    }

    showLoraInfo(lora, iconElement) {
        // Check if a popup already exists and remove it
        if (this.currentPopup) {
            this.currentPopup.remove();
        }
    
        // Create the popup container
        const popup = $el("div.model-info-popup", { className: "model-info-popup" });
    
        // Create the close button
        const closeButton = $el("button", {
            className: "close-button",
            textContent: "×",
            onclick: () => {
                popup.remove();
                document.removeEventListener("click", closePopup);
                this.currentPopup = null;
            }
        });
    
        // Create the content container
        const contentContainer = $el("div.popup-content");

        // Function to update media content
        const updateMediaContent = (updatedLora) => {
            // Remove existing media container if it exists
            const existingMediaContainer = contentContainer.querySelector('.media-container');
            if (existingMediaContainer) {
                existingMediaContainer.remove();
            }

            // Create and append new media container with updated data
            const mediaItems = updatedLora.images || [];
            const mediaContainer = $el("div.media-container");
            contentContainer.appendChild(mediaContainer);

            let currentIndex = 0;
            let prevButton, nextButton;

            const updateMedia = () => {
                mediaContainer.innerHTML = "";
                if (mediaItems.length > 0) {
                    const item = mediaItems[currentIndex];
                    const isVideo = item.type === 'video';
                    
                    const mediaElement = isVideo ? 
                        $el("video", {
                            src: item.url,
                            controls: true,
                            loop: true,
                        }) :
                        $el("img", {
                            style: {
                                opacity: 0,
                                transition: 'opacity 0.3s ease, transform 0.3s ease',
                            }
                        });

                    if (!isVideo) {
                        mediaElement.onload = () => {
                            mediaElement.style.opacity = 1;
                        };
                        mediaElement.src = item.url;
                    }

                    // Add media controls container
                    const mediaControls = $el("div.media-controls", [
                        // Set as preview button
                        $el("button.media-control-button", {
                            innerHTML: '<i class="pi pi-clone"></i>',
                            title: "Set as preview image",
                            onclick: async (e) => {
                                e.stopPropagation();
                                try {
                                    const response = await fetch('/lora_sidebar/set_preview', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            id: lora.id,
                                            url: item.url
                                        })
                                    });
                                    
                                    if (response.ok) {
                                        // Create new element with cache buster
                                        const newLoraElement = this.createLoraElement(lora, true);
                                        const existingLoraContainer = document.querySelector(`.lora-item img[src*="${encodeURIComponent(lora.id)}"]`)?.closest('.lora-item');
                                        if (existingLoraContainer) {
                                            if (existingLoraContainer.style.width) {
                                                newLoraElement.style.width = existingLoraContainer.style.width;
                                            }
                                            existingLoraContainer.replaceWith(newLoraElement);
                                        }
                                    }
                                } catch (error) {
                                    console.error('Error setting preview:', error);
                                }
                            }
                        }),
                        // Pop-out button
                        $el("button.media-control-button", {
                            innerHTML: '<i class="pi pi-window-maximize"></i>',
                            title: "View larger",
                            onclick: (e) => {
                                e.stopPropagation();
                                let currentIndex = mediaItems.indexOf(item);
                        
                                const createPopupContent = (index) => {
                                    const fullSizeUrl = mediaItems[index].url.replace(/\/width=\d+\//, '/');
                                    return [
                                        // Control buttons container
                                        $el("div.popup-controls", [
                                            // Set as preview button
                                            $el("button.popup-control-button", {
                                                innerHTML: '<i class="pi pi-clone"></i>',
                                                title: "Set as preview image",
                                                onclick: async (e) => {
                                                    e.stopPropagation();
                                                    try {
                                                        const response = await fetch('/lora_sidebar/set_preview', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                                id: lora.id,
                                                                url: mediaItems[currentIndex].url
                                                            })
                                                        });
                                                        
                                                        if (response.ok) {
                                                            const newLoraElement = this.createLoraElement(lora, true);
                                                            const existingLoraContainer = document.querySelector(`.lora-item img[src*="${encodeURIComponent(lora.id)}"]`)?.closest('.lora-item');
                                                            if (existingLoraContainer) {
                                                                if (existingLoraContainer.style.width) {
                                                                    newLoraElement.style.width = existingLoraContainer.style.width;
                                                                }
                                                                existingLoraContainer.replaceWith(newLoraElement);
                                                                this.showToast("success", "LoRA Preview Thumbnail Updated.");
                                                            }
                                                        }
                                                    } catch (error) {
                                                        console.error('Error setting preview:', error);
                                                    }
                                                }
                                            }),
                                            // Close button
                                            $el("button.popup-control-button", {
                                                innerHTML: '<i class="pi pi-times"></i>',
                                                title: "Close",
                                                onclick: (e) => {
                                                    e.stopPropagation();
                                                    popup.remove();
                                                }
                                            })
                                        ]),
                                        // Navigation buttons
                                        $el("button.nav-button.prev", {
                                            innerHTML: '<i class="pi pi-chevron-left"></i>',
                                            onclick: (e) => {
                                                e.stopPropagation();
                                                currentIndex = (currentIndex - 1 + mediaItems.length) % mediaItems.length;
                                                imageContainer.replaceChildren(...createPopupContent(currentIndex));
                                            },
                                            style: { display: mediaItems.length > 1 ? 'flex' : 'none' }
                                        }),
                                        $el("button.nav-button.next", {
                                            innerHTML: '<i class="pi pi-chevron-right"></i>',
                                            onclick: (e) => {
                                                e.stopPropagation();
                                                currentIndex = (currentIndex + 1) % mediaItems.length;
                                                imageContainer.replaceChildren(...createPopupContent(currentIndex));
                                            },
                                            style: { display: mediaItems.length > 1 ? 'flex' : 'none' }
                                        }),
                                        $el("img", {
                                            src: fullSizeUrl,
                                            onclick: (e) => e.stopPropagation()
                                        })
                                    ];
                                };

                                const imageContainer = $el("div.image-container");
                                const popup = $el("div.image-popup", [imageContainer]);
                                imageContainer.replaceChildren(...createPopupContent(currentIndex));
                                
                                document.body.appendChild(popup);

                                // Close when clicking outside or pressing escape
                                const closePopup = (e) => {
                                    if (e.key === 'Escape' || e.target === popup) {
                                        popup.remove();
                                        document.removeEventListener('keydown', closePopup);
                                        document.removeEventListener('click', closePopup);
                                    }
                                };

                                // Also close if clicking on the info popup
                                const infoPopup = document.querySelector('.model-info-popup');
                                if (infoPopup) {
                                    infoPopup.addEventListener('click', (e) => {
                                        if (e.target === infoPopup) {
                                            popup.remove();
                                        }
                                    });
                                }

                                // Close if info popup is closed
                                const observer = new MutationObserver((mutations) => {
                                    if (!document.contains(this.currentPopup)) {
                                        popup.remove();
                                        observer.disconnect();
                                    }
                                });
                                observer.observe(document.body, { childList: true, subtree: true });

                                document.addEventListener('keydown', closePopup);
                                document.addEventListener('click', closePopup);
                            }
                        })
                    ]);

                    mediaContainer.appendChild(mediaElement);
                    mediaContainer.appendChild(mediaControls);
                }

                // Re-append carousel buttons
                if (prevButton && nextButton) {
                    mediaContainer.appendChild(prevButton);
                    mediaContainer.appendChild(nextButton);
                }
            };

            if (mediaItems.length > 1) {
                prevButton = $el("button", {
                    textContent: "←",
                    onclick: () => {
                        currentIndex = (currentIndex - 1 + mediaItems.length) % mediaItems.length;
                        updateMedia();
                    },
                    className: "carousel-button prev"
                });

                nextButton = $el("button", {
                    textContent: "→",
                    onclick: () => {
                        currentIndex = (currentIndex + 1) % mediaItems.length;
                        updateMedia();
                    },
                    className: "carousel-button next"
                });

                mediaContainer.appendChild(prevButton);
                mediaContainer.appendChild(nextButton);
            }

            updateMedia();
        };

        const updateTrainedWords = (updatedLora) => {
            const existingWordsContainer = contentContainer.querySelector('.trained-words');
            if (existingWordsContainer && updatedLora.trained_words?.length > 0) {
                existingWordsContainer.replaceWith($el("div.trained-words", [
                    $el("h4", { textContent: "Trained Words:" }),
                    $el("div.word-pills", updatedLora.trained_words.map(word => 
                        $el("span.word-pill", { 
                            textContent: word,
                            onclick: () => this.copyToClipboard(word)
                        })
                    )),
                    $el("button.copy-all-button", {
                        textContent: "Copy All",
                        onclick: () => this.copyToClipboard(updatedLora.trained_words.join(", "))
                    })
                ]));
            }
        };
        
        const updateTags = (updatedLora) => {
            const existingTagsContainer = contentContainer.querySelector('.tags');
            if (existingTagsContainer && updatedLora.tags?.length > 0) {
                existingTagsContainer.replaceWith($el("div.tags", [
                    $el("h4", { textContent: "Tags:" }),
                    $el("div.word-pills", updatedLora.tags.map(tag => 
                        $el("span.word-pill", { 
                            textContent: tag,
                            onclick: () => this.copyToClipboard(tag)
                        })
                    ))
                ]));
            }
        };

        const fetchImagesIfNeeded = async () => {
            console.log("Checking for images:", {
                hasImages: !!lora.images,
                imageCount: lora.images?.length,
                baseModel: lora.baseModel,
                versionId: lora.versionId
            });
        
            if (!lora.images || lora.images.length === 0) {
                // Only fetch for non-custom LoRAs that have a versionId
                if (lora.baseModel !== 'custom' && lora.versionId) {
                    console.log("Fetching images for lora:", lora.name);
                    try {
                        const response = await fetch(`/lora_sidebar/refresh/${lora.versionId}`, {
                            method: 'POST'
                        });
                        
                        console.log("Response received:", response.status);
                        if (response.ok) {
                            const result = await response.json();
                            console.log("Got refresh result:", result);
                            if (result.status === 'success' && result.data) {
                                // Update the lora object with new data
                                Object.assign(lora, result.data);
                                // Update the media content
                                updateMediaContent(lora);
                                updateTrainedWords(lora);
                                updateTags(lora);
                            }
                        }
                    } catch (error) {
                        console.error('Error fetching LoRA images:', error);
                    }
                } else {
                    console.log("Skipping image fetch:", {
                        isCustom: lora.baseModel === 'custom',
                        hasVersionId: !!lora.versionId
                    });
                }
            }
        };

        // Add CivitAI link if modelId is available
        if (lora.modelId) {
            const civitAiLink = $el("a", {
                href: `https://civitai.com/models/${lora.modelId}`,
                textContent: `View on CivitAI`,
                target: "_blank",
                className: "civitai-link"
            });
            contentContainer.appendChild(civitAiLink);
        }

        // Add LoRA name and version name
        const nameContainer = $el("div.name-container");
        const nameElement = $el("h3", { textContent: lora.name, className: "lora-name" });
        nameContainer.appendChild(nameElement);
        
        if (lora.versionName) {
            const versionElement = $el("p", { 
                textContent: `Version: ${lora.versionName}`, 
                className: "version-name" 
            });
            nameContainer.appendChild(versionElement);
        }
        contentContainer.appendChild(nameContainer);

        // Add subdir information
        if (lora.subdir) {
            const subdirElement = $el("p", { 
                textContent: `Subdirectory: ${lora.subdir}`, 
                className: "lora-subdir" 
            });
            contentContainer.appendChild(subdirElement);
        }

        // Create delete button
        const deleteButton = $el("button", {
            className: "delete-button",
            textContent: "Delete",
            onclick: (e) => {
                e.stopPropagation();
                this.confirmDeleteLora(lora);
            }
        });
        contentContainer.appendChild(deleteButton);

        // Add base model if available
        if (lora.baseModel) {
            const baseModelElement = $el("p", { textContent: `Base Model: ${lora.baseModel}`, className: "base-model" });
            contentContainer.appendChild(baseModelElement);
        }

        // Add trained words
        const trainedWordsElement = $el("div.trained-words", [
            $el("h4", { textContent: "Trained Words:" }),
            $el("div.word-pills", 
                lora.trained_words && lora.trained_words.length > 0 
                    ? lora.trained_words.map(word => 
                        $el("span.word-pill", { 
                            textContent: word,
                            onclick: () => this.copyToClipboard(word)
                        })
                    )
                    : $el("span", { textContent: "None", className: "no-tags" })
            ),
            ...(lora.trained_words && lora.trained_words.length > 0 ? [
                $el("button.copy-all-button", {
                    textContent: "Copy All",
                    onclick: () => this.copyToClipboard(lora.trained_words.join(", "))
                })
            ] : [])
        ]);
        contentContainer.appendChild(trainedWordsElement);

        // Add tags
        const tagsElement = $el("div.tags", [
            $el("h4", { textContent: "Tags:" }),
            $el("div.word-pills", 
                lora.tags && lora.tags.length > 0 
                    ? lora.tags.map(tag => 
                        $el("span.word-pill", { 
                            textContent: tag,
                            onclick: () => this.copyToClipboard(tag)
                        })
                    )
                    : $el("span", { textContent: "None", className: "no-tags" })
            )
        ]);
        contentContainer.appendChild(tagsElement);

        // Update initial media content
        updateMediaContent(lora);
        
        // Fetch images if needed
        fetchImagesIfNeeded();

        // Append the close button and content container to popup
        popup.appendChild(closeButton);
        popup.appendChild(contentContainer);

        // Add NSFW warning if applicable
        if (this.isNSFW(lora)) {
            const nsfwWarning = $el("p.nsfw-warning", { 
                textContent: lora.nsfw 
                    ? "This LoRA contains NSFW content" 
                    : `This LoRA has an NSFW level of ${lora.nsfwLevel}`,
                style: {
                    color: "#ff4444",
                    fontWeight: "bold"
                }
            });
            contentContainer.appendChild(nsfwWarning);
        }
    
        // Position the popup
        const sidebar = document.querySelector('.lora-sidebar');
        const sidebarRect = sidebar.getBoundingClientRect();
        
        popup.style.position = 'fixed';
        popup.style.left = `${sidebarRect.left + 10}px`;  // 10px padding from left
        popup.style.top = '50%';
        popup.style.transform = 'translateY(-50%)';
        popup.style.maxHeight = '80vh';
        popup.style.overflowY = 'auto';
        popup.style.width = `${sidebarRect.width - 20}px`;  // 20px total padding
    
        // Append the popup to the body
        document.body.appendChild(popup);

        // Add show class to trigger transition
        setTimeout(() => popup.classList.add('show'), 0);
    
        // Close the popup when clicking outside
        const closePopup = (event) => {
            if (!popup.contains(event.target) && event.target !== iconElement) {
                popup.remove();
                document.removeEventListener("click", closePopup);
                this.currentPopup = null;
            }
        };
        setTimeout(() => {
            document.addEventListener("click", closePopup);
        }, 0);

        // Update the current popup reference
        this.currentPopup = popup;
    }

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            this.showToast("success", "Copied", "Text copied to clipboard.");
        }).catch(err => {
            console.error('Failed to copy text:', err);
            this.showToast("error", "Copy Failed", "Failed to copy text to clipboard.");
        });
    }

    confirmDeleteLora(lora) {
        // Split the path into directory and filename
        const fullPath = lora.path || "";
        const directory = fullPath.substring(0, fullPath.lastIndexOf('\\'));
        const filename = fullPath.substring(fullPath.lastIndexOf('\\') + 1);
    
        const confirmPopup = $el("div.confirm-delete-popup", [
            $el("p", { 
                textContent: "Are you sure you want to delete this LoRA? This won't remove the LoRA from your hard drive, but you can remove it manually." 
            }),
            $el("p", { 
                className: "file-location-label",
                textContent: "Folder location:"
            }),
            $el("p", { 
                className: "file-location",
                textContent: directory || "Path not available"
            }),
            $el("p", { 
                className: "file-location-label",
                textContent: "File name:"
            }),
            $el("p", { 
                className: "file-location",
                textContent: filename || "Filename not available"
            }),
            $el("div.confirm-buttons", [
                $el("button", {
                    textContent: "Cancel",
                    onclick: () => document.body.removeChild(confirmPopup)
                }),
                $el("button", {
                    textContent: "Delete",
                    onclick: () => this.deleteLora(lora)
                })
            ])
        ]);
        document.body.appendChild(confirmPopup);
    }

    async deleteLora(lora) {
        try {
            const response = await api.fetchApi('/lora_sidebar/delete_lora', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: lora.id })
            });

            if (response.ok) {
                // Remove lora from data arrays
                this.loraData = this.loraData.filter(l => l.id !== lora.id);
                this.filteredData = this.filteredData.filter(l => l.id !== lora.id);

                // Close popups
                if (this.currentPopup) {
                    this.currentPopup.remove();
                    this.currentPopup = null;
                }
                document.querySelector('.confirm-delete-popup').remove();

                // Redraw sidebar
                this.renderLoraGallery();

                this.showToast("success", "LoRA Deleted", `${lora.name} has been deleted successfully.`);
            } else {
                throw new Error('Failed to delete LoRA');
            }
        } catch (error) {
            console.error("Error deleting LoRA:", error);
            this.showToast("error", "Deletion Failed", `Failed to delete ${lora.name}.`);
        }
    }

    handleFirstOpen() {
        if (this.isFirstOpen) {
            this.isFirstOpen = false;
            this.isNewSession = this.checkNewSession();
            // Re-initialize state if it's a new session
            if (this.isNewSession) {
                this.state = this.getDefaultState();
            }
        }
    }

    ///////

    updateShowNSFW(newVal) {
        this.showNSFW = newVal;
        if (!this.isFirstOpen) {
        this.handleSearch(this.state.searchTerm || '');  // Re-filter using current search term
        }
    }

    updateNSFWlevel(newVal) {
        this.nsfwThreshold = newVal;
        if (!this.isFirstOpen) {
        this.handleSearch(this.state.searchTerm || '');
        }
    }
    
    updateSavedModelFilter(newVal) {
        this.savedModelFilter = newVal;
        this.modelFilter = newVal;  // Update the current model filter
        if (!this.isFirstOpen) {
        this.handleSearch(this.state.searchTerm || '');
        }
    }

    updateSortOrder(newVal) {
        this.sortModels = newVal;
        if (!this.isFirstOpen) {
        this.handleSearch(this.state.searchTerm || '');
        }
    }

    updateLoraSize(newVal) {
        this.savedElementSize = newVal;
        this.elementSize = newVal;
        if (!this.isFirstOpen) {
        this.update();
        }
    }

    updateTags(newVal) {
        this.CUSTOM_TAGS = newVal.split(',').map(tag => tag.trim().toLowerCase());
        if (this.tagSource === 'Custom' && !this.isFirstOpen) {
        this.handleSearch(this.state.searchTerm || '');
        }
    }

    updateTagSource(newVal) {
        this.tagSource = newVal;
        if (!this.isFirstOpen) {
        this.handleSearch(this.state.searchTerm || '');
        }
    }

    updateCategoryState(newVal) {
        this.defaultCatState = newVal === "Expanded";
    }

    updateBatchSize(newVal) {
        this.batchSize = newVal;
    }

    updateFavState(newVal) {
        this.favState = newVal;
    }

    ////////

    async update() {
        debug.log("LoRA Sidebar update called");

        if (this.isFirstOpen) {
            // Do nothing if the sidebar hasn't been opened yet
            return;
        }
        
        if (this.isNewSession) {
            const unprocessedCount = await this.checkUnprocessedLoras();
            debug.log(`Unprocessed LoRAs: ${unprocessedCount}`);
            if (unprocessedCount > 0) {
                const shouldProcess = await this.showUnprocessedLorasPopup(unprocessedCount);
                if (shouldProcess) {
                    await this.processLoras();
                }
            }
            await this.loadLoraData();
            this.isNewSession = false;
            this.saveState(); // Save the state after initial load
        }
    
        this.handleSearch(this.state.searchTerm || '');
    }

}

app.registerExtension({
    name: "comfy.lora.sidebar",
    async setup() {
        const loraSidebar = new LoraSidebar(app);
        app.loraSidebar = loraSidebar;

        app.extensionManager.registerSidebarTab({
            id: "lora.sidebar",
            icon: "pi pi-address-book",
            title: "LoRA Sidebar",
            tooltip: "LoRA Sidebar",
            type: "custom",
            render: (el) => {
                el.appendChild(loraSidebar.element);
                if (loraSidebar.isFirstOpen) {
                    loraSidebar.isFirstOpen = false;
                    loraSidebar.isNewSession = loraSidebar.checkNewSession();
                }
                loraSidebar.update();
                loraSidebar.setupScrollHandler();
                loraSidebar.setupCanvasDropHandling();
            },
        });

        app.ui.settings.addSetting({
            id: "LoRA Sidebar.General.showModels",
            name: "Base Models to Show",
            type: 'combo',
            options: ['All', 'Pony', 'Flux', 'SDXL', 'SD1.5', 'Other'],
            defaultValue: 'All',
            onChange: (newVal, oldVal) => {
                if (app.loraSidebar && oldVal !== undefined) {
                    app.loraSidebar.updateSavedModelFilter(newVal);
                }
            }
        });

        app.ui.settings.addSetting({
            id: "LoRA Sidebar.General.catState",
            name: `Default Category State`,
            tooltip : 'Minimized is much faster if you have a LOT (1000s) of LoRAs',
            type: 'combo',
            options: ['Expanded', 'Minimized'],
            defaultValue: 'Expanded',
            onChange: (newVal, oldVal) => {
                if (app.loraSidebar && oldVal !== undefined) {
                    app.loraSidebar.updateCategoryState(newVal);
                }
            }
        });

        app.ui.settings.addSetting({
            id: "LoRA Sidebar.General.favState",
            name: `Expand Favorites`,
            tooltip : 'Default Favorites to expanded regardless of other settings',
            type: "boolean",
            defaultValue: true,
            onChange: (newVal, oldVal) => {
                if (app.loraSidebar && oldVal !== undefined) {
                    app.loraSidebar.updateFavState(newVal);
                }
            }
        });

        app.ui.settings.addSetting({
            id: "LoRA Sidebar.General.sortModels",
            name: "Sort LoRAs By",
            tooltip : 'Subdir uses your directory structure, Tags use model tags pulled from CivitAI',
            type: 'combo',
            options: ['None', 'Subdir', 'Tags'],
            defaultValue: 'None',
            onChange: (newVal, oldVal) => {
                if (app.loraSidebar && oldVal !== undefined) {
                    app.loraSidebar.updateSortOrder(newVal);
                }
            }
        });

        app.ui.settings.addSetting({
            id: "LoRA Sidebar.General.tagSource",
            name: "Tags to Use",
            tooltip : 'CivitAI uses the main site categories like Character, Clothing, Poses, etc.',
            type: 'combo',
            options: ['CivitAI', 'Custom'],
            defaultValue: 'CivitAI',
            onChange: (newVal, oldVal) => {
                if (app.loraSidebar && oldVal !== undefined) {
                    app.loraSidebar.updateTagSource(newVal);
                }
            }
        });

        app.ui.settings.addSetting({
            id: "LoRA Sidebar.General.customTags",
            name: "Custom Category Tags",
            tooltip : 'Comma seperated list of tags, each Lora will only be assigned to 1 category',
            type: 'text',
            defaultValue: 'character, style, concept, clothing, poses, background',
            onChange: (newVal, oldVal) => {
                if (app.loraSidebar && oldVal !== undefined) {
                    app.loraSidebar.updateTags(newVal);
                }
            }
        });

        app.ui.settings.addSetting({
            id: "LoRA Sidebar.General.thumbnailSize",
            name: "LoRA Display Size",
            type: "slider",
            defaultValue: 125,
            attrs: { min: 50, max: 400, step: 25, },
            onChange: (newVal, oldVal) => {
                if (app.loraSidebar && oldVal !== undefined) {
                    app.loraSidebar.updateLoraSize(newVal);
                }
            }
        });

        app.ui.settings.addSetting({
            id: "LoRA Sidebar.General.batchSize",
            name: "LoRA Loading Batch Size",
            tooltip : 'If you have tons of LoRAs but good hardware (and SSDs) you can push this up to 5k or more',
            type: "slider",
            defaultValue: 500,
            attrs: { min: 250, max: 10000, step: 250, },
            onChange: (newVal, oldVal) => {
                if (app.loraSidebar && oldVal !== undefined) {
                    app.loraSidebar.updateBatchSize(newVal);
                }
            }
        });

        app.ui.settings.addSetting({
            id: "LoRA Sidebar.NSFW.hideNSFW",
            name: "Show NSFW LoRAs",
            tooltip : 'Uses the CivitAI NSFW flags which are not very reliable',
            type: "boolean",
            defaultValue: true,
            onChange: (newVal, oldVal) => {
                if (app.loraSidebar && oldVal !== undefined) {
                    app.loraSidebar.updateShowNSFW(newVal);
                }
            }
        });

        app.ui.settings.addSetting({
            id: "LoRA Sidebar.NSFW.nsfwLevel",
            name: "Max Allowed NSFW Level (50 Allows All Content)",
            tooltip : 'Calculates how NSFW a LoRA is using the CivitAI NSFW score of sample images',
            type: "slider",
            defaultValue: 25,
            attrs: { min: 1, max: 50, step: 1, },
            onChange: (newVal, oldVal) => {
                if (app.loraSidebar && oldVal !== undefined) {
                    app.loraSidebar.updateNSFWlevel(newVal);
                }
            }
        });
    },
});