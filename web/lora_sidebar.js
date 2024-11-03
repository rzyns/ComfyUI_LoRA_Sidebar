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
        this.SorthMethod = app.ui.settings.getSettingValue("LoRA Sidebar.General.sortMethod", 'AlphaAsc');
        this.minSize = 100;
        this.maxSize = 400;
        this.loadingDelay = 800; // continuous loading delay
        this.initialIndex = 500;
        this.searchDelay = 150;
        this.searchTimeout = null;
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
        this.a1111Style = app.ui.settings.getSettingValue("LoRA Sidebar.General.a1111Style", false);
        this.UseRG3 = app.ui.settings.getSettingValue("LoRA Sidebar.General.useRG3", false);
        this.infoPersist = app.ui.settings.getSettingValue("LoRA Sidebar.General.infoPersist", true);
        
        this.element = $el("div.lora-sidebar", {
            draggable: false,
        }, [
            $el("div.lora-sidebar-content", {
                draggable: false,
            }, [
                $el("h3", "LoRA Sidebar"),
                this.searchInput,
                this.modelFilterDropdown,
                this.sizeSlider,
                this.loadingIndicator,
                this.galleryContainer,
                this.progressBar
            ])
        ]);

        this.preventDragging();

        this.placeholderUrl = "/lora_sidebar/placeholder";
        this.CatNew = app.ui.settings.getSettingValue("LoRA Sidebar.General.catNew", true);

        this.showNSFW = app.ui.settings.getSettingValue("LoRA Sidebar.NSFW.hideNSFW", true);
        this.nsfwThreshold = app.ui.settings.getSettingValue("LoRA Sidebar.NSFW.nsfwLevel", 25);
        this.nsfwFolder = app.ui.settings.getSettingValue("LoRA Sidebar.NSFW.nsfwFolder", true);

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

    preventDragging() {
        const makeNotDraggable = (element) => {
            // Skip elements with class lora-overlay
            if (!element.classList?.contains('lora-overlay')) {
                element.draggable = false;
                // Recursively process all children
                Array.from(element.children).forEach(child => makeNotDraggable(child));
            }
        };
    
        // Start with the sidebar element
        makeNotDraggable(this.element);
    }    

    createSizeSlider() {
        this.sizeSlider = $el("input.lora-size-slider", {
            type: "range",
            min: this.minSize,
            max: this.maxSize,
            value: this.elementSize,
            draggable: false,
            oninput: (e) => {
                this.elementSize = parseInt(e.target.value);
                this.updateGalleryLayout();
            }
        });
        return this.sizeSlider;
    }

    createModelFilterDropdown() {
        const filterOptions = ['All', 'Pony', 'Flux', 'SD 3.5', 'Illustrious', 'SDXL', 'SD 1.5', 'Custom + Other'];
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
                oninput: (e) => this.debouncedSearch(e.target.value)
            }),
            $el("button.search-clear", {
                innerHTML: "&#x2715;",
                title: "Clear search",
                onclick: () => {
                    const searchInput = this.element.querySelector('.search-input');
                    searchInput.value = '';
                    this.debouncedSearch('');
                }
            })
        ]);
    
        return searchContainer;
    }

    debouncedSearch(searchInput) {
        // Clear any existing timeout
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }

        // Set a new timeout
        this.searchTimeout = setTimeout(() => {
            this.handleSearch(searchInput);
        }, this.searchDelay);
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
        this.galleryContainer = $el("div.lora-gallery-container", {
            draggable: false,            
        });
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
            if (a.getAttribute('data-category') === 'New') return -1;
            if (b.getAttribute('data-category') === 'New') return 1;
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
        let items;
        const NEW_CATEGORY_LIMIT = 100;

        if (categoryName === "Favorites") {
            items = this.filteredData.filter(lora => lora.favorite);
        } else if (categoryName === "New") {
            // Only process if the setting is enabled
            if (!this.CatNew) {
                return [];
            }

            // Get new items excluding favorites
            let newItems = this.filteredData.filter(lora => lora.is_new && !lora.favorite);

            // If we have more than limit items, check if they all have the same date
            if (newItems.length > NEW_CATEGORY_LIMIT) {
                // Get unique creation times
                const uniqueDates = new Set(newItems.map(lora => lora.created_time));
                
                // If all items have the same date (likely initial import)
                // and we're over the limit, disable the category
                if (uniqueDates.size === 1) {
                    return [];
                }

                // Otherwise, just limit to the most recent items
                newItems.sort((a, b) => b.created_time - a.created_time);
                newItems = newItems.slice(0, NEW_CATEGORY_LIMIT);
            }

            items = newItems;
        } else if (this.sortModels === 'Subdir') {
            items = this.filteredData.filter(lora => {
                const parts = lora.subdir ? lora.subdir.split('\\') : [];
                return parts[parts.length - 1] === categoryName || (categoryName === "Unsorted" && !lora.subdir);
            });
        } else if (this.sortModels === 'Tags') {
            if (activeTags.includes(categoryName)) {
                items = this.filteredData.filter(lora => 
                    lora.tags && lora.tags.includes(categoryName)
                );
            } else if (categoryName === 'Unsorted') {
                items = this.filteredData.filter(lora => 
                    !lora.tags || !activeTags.some(tag => lora.tags.includes(tag))
                );
            }
        }

        // THIS IS WHERE OUR SORT HAPPENS ADN WE'RE DOING IT IN THE BE NOW WOOHOO
        //if (items && items.length > 0) {
        //    items.sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()));
        //}

        return items || [];
    }

    sanitizeHTML(html) {
        // Create a temporary element
        const temp = document.createElement('div');
        temp.innerHTML = html;
        
        // Remove any script tags
        const scripts = temp.getElementsByTagName('script');
        while (scripts[0]) {
            scripts[0].parentNode.removeChild(scripts[0]);
        }
        
        // Remove any style tags
        const styles = temp.getElementsByTagName('style');
        while (styles[0]) {
            styles[0].parentNode.removeChild(styles[0]);
        }
        
        // Remove any on* attributes (onclick, onmouseover, etc.)
        const all = temp.getElementsByTagName('*');
        for (let i = 0; i < all.length; i++) {
            const attrs = all[i].attributes;
            for (let j = attrs.length - 1; j >= 0; j--) {
                if (attrs[j].name.startsWith('on')) {
                    all[i].removeAttribute(attrs[j].name);
                }
            }
        }
        
        // Return the sanitized HTML
        return temp.innerHTML;
    }
        
    matchesModelFilter(lora, filter) {
        const baseModel = (lora.baseModel || '').toLowerCase();
        switch (filter) {
            case 'Pony':
                return baseModel.includes('pony');
            case 'Flux':
                return baseModel.includes('flux');
            case 'SD 3.5':
                return baseModel.includes('sd') && baseModel.includes('3.5');
            case 'Illustrious':
                return baseModel.includes('illustrious');
            case 'SDXL':
                return baseModel.includes('sdxl');
            case 'SD 1.5':
                return baseModel.includes('sd') && baseModel.includes('1.5');
            case 'Custom + Other':
                return !['pony', 'flux', 'sdxl', 'illustrious'].some(model => baseModel.includes(model)) &&
                !(baseModel.includes('sd') && (baseModel.includes('1.5') || baseModel.includes('3.5')));
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
            // Get current sort preference - you can store this in your class or get from UI
            const sortPreference = this.SorthMethod || 'AlphaAsc'; // default to alpha

            // Determine sort type and direction
            let sortType, ascending;
            switch(sortPreference) {
                case 'AlphaAsc':
                    sortType = 'alpha';
                    ascending = true;
                    break;
                case 'AlphaDesc':
                    sortType = 'alpha';
                    ascending = false;
                    break;
                case 'DateNewest':
                    sortType = 'date';
                    ascending = false;
                    break;
                case 'DateOldest':
                    sortType = 'date';
                    ascending = true;
                    break;
                default:
                    sortType = 'alpha';
                    ascending = true;
            }
            
            // Build the URL with sort parameters
            const url = `/lora_sidebar/data?` + new URLSearchParams({
                offset: offset,
                limit: limit,
                sort: sortType,
                ascending: ascending,
                nsfw_folder: this.nsfwFolder
            });

            const response = await api.fetchApi(url);
            if (response.ok) {
                const data = await response.json();
                if (data && data.loras) {
                    const favorites = data.favorites || [];
                    // Use a Set to keep track of unique LoRA IDs
                    const existingLoraIds = new Set(this.loraData.map(lora => lora.id));

                    const newLoras = data.loras
                    .filter(lora => !existingLoraIds.has(lora.id))
                    .map(lora => ({
                        ...lora,
                        favorite: favorites.includes(lora.id)
                    }));

                    debug.log("Loaded LoRAs with new flags:", newLoras.filter(l => l.is_new));
                    
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
        try {
            if (startIndex === 0) {
                this.galleryContainer.innerHTML = '';
            }
    
            debug.log(`renderLoraGallery called with startIndex: ${startIndex}, count: ${count}`);
            debug.log(`Current filteredData length: ${this.filteredData.length}`);
        
            // Render Favorites
            const favorites = this.getCategoryItems("Favorites");
            if (favorites.length > 0 && startIndex === 0) {
                try {
                    const favoritesCategory = this.createCategoryElement("Favorites", favorites);
                    if (favoritesCategory) {
                        this.galleryContainer.appendChild(favoritesCategory);
                    }
                } catch (error) {
                    console.error('Error rendering favorites:', error);
                }
            }

            // Render New Items
            const newItems = this.getCategoryItems("New");
            if (newItems.length > 0 && startIndex === 0) {
                try {
                    const newCategory = this.createCategoryElement("New", newItems);
                    if (newCategory) {
                        this.galleryContainer.appendChild(newCategory);
                    }
                } catch (error) {
                    console.error('Error rendering new items:', error);
                }
            }
        
            // Render LoRAs (excluding favorites and new items)
            const categoryItems = new Set([
                ...favorites.map(l => l.id),
                ...newItems.map(l => l.id)
            ]);
            const otherLoras = this.filteredData.filter(lora => !categoryItems.has(lora.id));

            // const otherLoras = this.filteredData.filter(lora => !lora.favorite && !lora.is_new);
            const endIndex = Math.min(startIndex + count, otherLoras.length);
            const lorasToRender = otherLoras.slice(startIndex, endIndex);
        
            if (this.sortModels === 'Subdir') {
                const categories = {};
                lorasToRender.forEach(lora => {
                    try {
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
                    } catch (error) {
                        console.error('Error processing LoRA:', lora, error);
                    }
                });
        
                Object.entries(categories).forEach(([category, loras]) => {
                    try {
                        if (loras.length > 0) {
                            let categoryElement = this.galleryContainer.querySelector(`.lora-category[data-category="${category}"]`);
                            if (!categoryElement) {
                                categoryElement = this.createCategoryElement(category, loras);
                                if (categoryElement) {
                                    this.galleryContainer.appendChild(categoryElement);
                                }
                            } else {
                                const lorasContainer = categoryElement.querySelector('.lora-items-container');
                                const isExpanded = window.getComputedStyle(lorasContainer).display !== 'none';
                                this.createCategoryElement(category, loras, true);
                                if (!isExpanded) {
                                    lorasContainer.style.display = 'none';
                                }
                            }
                        }
                    } catch (error) {
                        console.error('Error creating category:', category, error);
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
                    try {
                        // NSFW check
                        if (this.isNSFW(lora) && !this.showNSFW) {
                            return;
                        }
    
                        let categorized = false;
                        for (const tag of activeTags) {
                            if (lora.tags && lora.tags.includes(tag)) {
                                categories[tag].push(lora);
                                categorized = true;
                                break;
                            }
                        }
                        if (!categorized) {
                            categories['Unsorted'].push(lora);
                        }
                    } catch (error) {
                        console.error('Error processing LoRA:', lora, error);
                    }
                });
        
                Object.entries(categories).forEach(([category, loras]) => {
                    try {
                        if (loras.length > 0) {
                            let categoryElement = this.galleryContainer.querySelector(`.lora-category[data-category="${category}"]`);
                            if (!categoryElement) {
                                categoryElement = this.createCategoryElement(category, loras);
                                if (categoryElement) {
                                    this.galleryContainer.appendChild(categoryElement);
                                }
                            } else {
                                const lorasContainer = categoryElement.querySelector('.lora-items-container');
                                const isExpanded = window.getComputedStyle(lorasContainer).display !== 'none';
                                this.createCategoryElement(category, loras, true);
                                if (!isExpanded) {
                                    lorasContainer.style.display = 'none';
                                }
                            }
                        }
                    } catch (error) {
                        console.error('Error creating category:', category, error);
                    }
                });
    
                this.sortCategories();
    
            } else {
                try {
                    let allLorasCategory = this.galleryContainer.querySelector('.lora-category[data-category="All LoRAs"]');
                    if (!allLorasCategory || startIndex === 0) {
                        allLorasCategory = this.createCategoryElement("All LoRAs", lorasToRender);
                        if (allLorasCategory) {
                            this.galleryContainer.appendChild(allLorasCategory);
                        }
                    } else {
                        this.createCategoryElement("All LoRAs", lorasToRender, true);
                    }
                } catch (error) {
                    console.error('Error creating All LoRAs category:', error);
                }
            }
        
            this.updateGalleryLayout();
            this.initialRenderComplete = true;
        } catch (error) {
            console.error('Critical error in renderLoraGallery:', error);
        }
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
                categoryContainer = $el("div.lora-category", {
                    draggable: false
                });
                
                // Manually set the data-category attribute
                categoryContainer.setAttribute('data-category', categoryName);
                
                this.galleryContainer.appendChild(categoryContainer);
            } else {
                // Make sure existing containers are also not draggable
                categoryContainer.draggable = false;
            }                
        } else {
            categoryContainer = $el("div.lora-category", {
                draggable: false  // Add here
            });
            
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
            
            header = $el("div.category-header", {
                draggable: false
            }, [
                $el("h3.category-title", {}, [categoryName]),
                $el("span.category-toggle", {}, [isExpanded ? "▼" : "▶"])
            ]);
            
            header.addEventListener('click', () => this.toggleCategory(categoryName));
            
            categoryContainer.appendChild(header);
        }
    
        let lorasContainer = categoryContainer.querySelector('.lora-items-container');
        if (!lorasContainer) {
            lorasContainer = $el("div.lora-items-container", {
                draggable: false
            });

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
        try {
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

                        
                        // Debug logs for element finding
                        const loraItem = e.target.parentElement;
                        debug.log("LoRA Item found:", loraItem);

                        const img = loraItem.querySelector('img');
                        debug.log("Image element found:", img);

                        if (img) {
                            debug.log("Attempting to set drag image:", {
                                width: img.width,
                                height: img.height,
                                src: img.src,
                                complete: img.complete
                            });
                            e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2);
                        } else {
                            console.error("No image element found in LoRA item");
                        }


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
            } catch (error) {
                console.error('Failed to create LoRA element:', lora?.name || 'unknown', error);
                return null;
            }
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
                    // Check local_metadata flag to determine if this is a custom LoRA
                    if (lora.local_metadata) {
                        this.showToast("warn", "Custom LoRA Detected", 'Skipping refresh for custom LoRA, please use the LoRA Info Pop-up window to update metadata and images for Custom LoRAs.', 5000);
                        return; // Exit early for custom LoRA
                    } else {
                        throw new Error(`Failed to perform hash lookup for LoRA: ${lora.name}, model probably removed.`);
                    }
                }
    
                const idResult = await idResponse.json();
                if (idResult.status === 'success' && idResult.data && idResult.data.versionId) {
                    versionId = idResult.data.versionId;
                    debug.log(`Found versionId ${versionId} for LoRA ${lora.name}`);
                } else {
                    throw new Error(`Missing or malformed data in API response for LoRA: ${lora.name}`);
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
                        this.handleSearch(this.state.searchTerm || '');
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
                        reco_weight: loraData.reco_weight,
                        path: loraData.subdir || "",
                        filename: loraData.filename,
                        trainedWords: loraData.trained_words
                    };
    
                    let attempts = 0;
                    const maxAttempts = 3;
                    
                    const tryCreateNode = () => {
                        attempts++;
                        debug.log(`Attempt ${attempts} to create/update node`);
    
                        requestAnimationFrame(() => {
                            try {
                                const node = app.graph.getNodeOnPos(dropX, dropY);
                                
                                if (node) {
                                    if (node.type === "LoraLoader" || node.type === "Power Lora Loader (rgthree)") {
                                        this.updateLoraNode(node, loraData);
                                        debug.log("Successfully updated node");
                                    } else if (nodeData.trainedWords?.length > 0) {
                                        // Check if node has any text widgets
                                        const textWidget = node.widgets?.find(w => 
                                            w.name === "text" ||
                                            w.name === "string" ||
                                            w.name === "prompt"  // Some nodes might use "prompt" for text input
                                        );
                                        node.widgets?.forEach(w => {
                                            debug.log("Widget:", w.name, "Type:", w.type, "Widget type:", w.widget_type);
                                            debug.log("Node:", node.name, "Type:", node.type);
                                        });
                                        
                                        if (textWidget) {
                                            // Append the first trained word to existing text
                                            const currentText = textWidget.value || "";
                                            let newText = currentText;
                                            let trainedWords = nodeData.trainedWords[0];

                                            // If a1111Style is enabled, prefix the trained word with the LoRA syntax
                                            if (this.a1111Style) {
                                                // Format the path+name part, using / for subdir separator
                                                const loraPath = nodeData.path ? `${nodeData.path}/` : '';
                                                const loraPart = `${loraPath}${nodeData.name}`;
                                                // Get weight, default to 1 if not present
                                                const weight = nodeData.reco_weight ?? 1;
                                                // Format the weight to avoid unnecessary decimal places
                                                const weightStr = weight.toString().includes('.') ? weight.toFixed(2) : weight;
                                                // Construct the full A1111 style prefix
                                                trainedWords = `<lora:${loraPart}:${weightStr}>, ${trainedWords}`;
                                            }

                                            if (currentText.length > 0) {
                                                if (currentText.endsWith(", ")) {
                                                    newText = currentText + trainedWords;
                                                } else if (currentText.endsWith(",")) {
                                                    newText = currentText + " " + trainedWords;
                                                } else {
                                                    newText = currentText + ", " + trainedWords;
                                                }
                                            } else {
                                                newText = trainedWords;
                                            }
                                            
                                            textWidget.value = newText;
                                            node.setDirtyCanvas(true, true);
                                            debug.log("Successfully added trigger word to text widget");
                                        }
                                    }
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
        if (this.UseRG3) {
            // Create Power Lora Loader node
            const node = LiteGraph.createNode("Power Lora Loader (rgthree)");
            node.pos = [x, y];
            
            // Add the node to the graph (this needs to happen before we add widgets)
            app.graph.add(node);
            
            // Use our existing code to add the lora to the new node
            const widget = node.addNewLoraWidget();
            
            const weight = loraData.reco_weight ?? 1;
            const loraPath = `${loraData.path}${loraData.path ? '\\' : ''}${loraData.filename}`;
            
            widget.value = {
                on: true,
                lora: loraPath,
                strength: weight,
                strengthTwo: null
            };
    
            widget.loraInfo = {
                file: loraData.filename,
                path: loraPath,
                images: []
            };
    
            // Handle node resizing
            const computed = node.computeSize();
            const tempHeight = node._tempHeight ?? 15;
            node.size[1] = Math.max(tempHeight, computed[1]);
            
            node.setDirtyCanvas(true, true);
        } else {
            // Original LoraLoader code
            const node = LiteGraph.createNode("LoraLoader");
            node.pos = [x, y];
            
            // Set node title
            node.title = `Lora - ${loraData.name}`;
            
            // Get recommended weight, default to 1 if not present
            const weight = loraData.reco_weight ?? 1;
            
            // Set widget values
            for (const widget of node.widgets) {
                if (widget.name === "lora_name") {
                    widget.value = `${loraData.path}${loraData.path ? '\\' : ''}${loraData.filename}`;
                } else if (widget.name === "strength_model") {
                    widget.value = weight;
                } else if (widget.name === "strength_clip") {
                    widget.value = weight;
                }
            }
            
            // Add the node to the graph
            app.graph.add(node);
        }
        
        // Ensure the canvas is updated
        app.graph.setDirtyCanvas(true, true);
    }

    updateLoraNode(node, loraData) {
        // Handle different node types
        if (node.type === "LoraLoader") {
            // Update the node title
            node.title = `Lora - ${loraData.name}`;
            
            // Get recommended weight, default to 1 if not present
            const weight = loraData.reco_weight ?? 1;
            
            // Update widget values
            for (const widget of node.widgets) {
                if (widget.name === "lora_name") {
                    widget.value = `${loraData.subdir}${loraData.subdir ? '\\' : ''}${loraData.filename}`;
                } else if (widget.name === "strength_model") {
                    widget.value = weight;
                } else if (widget.name === "strength_clip") {
                    widget.value = weight;
                }
            }

        } else if (node.type === "Power Lora Loader (rgthree)") {
            console.error("Starting update with data:", loraData);
        
            const widget = node.addNewLoraWidget();
            console.error("Created widget:", widget);
    
            const weight = loraData.reco_weight ?? 1;
            const loraPath = `${loraData.subdir}${loraData.subdir ? '\\' : ''}${loraData.filename}`;
            
            widget.value = {
                on: true,
                lora: loraPath,
                strength: weight,
                strengthTwo: null
            };
    
            widget.loraInfo = {
                file: loraData.filename,
                path: loraPath,
                images: []
            };
    
            // Handle node resizing
            const computed = node.computeSize();
            const tempHeight = node._tempHeight ?? 15;
            node.size[1] = Math.max(tempHeight, computed[1]);
            
            node.setDirtyCanvas(true, true);
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
        const popup = $el("div.model-info-popup", { 
            className: "model-info-popup",
            onmousedown: (e) => {
                // Store the initial mouse down target
                popup.dataset.mouseDownTarget = 'inside';
                e.stopPropagation();
            },
            onmouseleave: () => {
                // Clear the target if mouse leaves the popup
                popup.dataset.mouseDownTarget = '';
            }
        });
    
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
                                            debug.log('We got a response and tried to replce the container.');
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
                                const popup = $el("div.image-popup", {
                                    onclick: (e) => {
                                        if (e.target === popup) {
                                            e.stopPropagation();
                                            popup.remove();
                                        }
                                    }
                                }, [imageContainer]);
                                imageContainer.replaceChildren(...createPopupContent(currentIndex));
                                
                                document.body.appendChild(popup);

                                // Close when clicking outside or pressing escape
                                const closePopup = (e) => {
                                    if (e.key === 'Escape') {
                                        e.stopPropagation();  // Prevent the escape from bubbling
                                        popup.remove();
                                        document.removeEventListener('keydown', closePopup);
                                    }
                                };

                                // Also close if clicking on the info popup background
                                const infoPopup = document.querySelector('.model-info-popup');
                                if (infoPopup) {
                                    infoPopup.addEventListener('click', (e) => {
                                        // Only handle clicks on the actual background of the info popup
                                        if (e.target === infoPopup) {
                                            e.stopPropagation();  // Prevent the click from closing the info popup
                                            popup.remove();
                                        }
                                    });
                                }

                                // Close if esc is pressed
                                document.addEventListener('keydown', closePopup);
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
            debug.log("Checking for images:", {
                hasImages: !!lora.images,
                imageCount: lora.images?.length,
                baseModel: lora.baseModel,
                versionId: lora.versionId
            });
        
            if (!lora.images || lora.images.length === 0) {
                // Only fetch for non-custom LoRAs that have a versionId
                if (lora.baseModel !== 'custom' && lora.versionId) {
                    debug.log("Fetching images for lora:", lora.name);
                    try {
                        const response = await fetch(`/lora_sidebar/refresh/${lora.versionId}`, {
                            method: 'POST'
                        });
                        
                        debug.log("Response received:", response.status);
                        if (response.ok) {
                            const result = await response.json();
                            debug.log("Got refresh result:", result);
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
                    debug.log("Skipping image fetch:", {
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

        const createDescriptionPopup = (description, event) => {
            // Remove any existing description popup
            const existingPopup = document.querySelector('.description-popup');
            if (existingPopup) {
                existingPopup.remove();
            }

            if (!description) return;

            const popup = $el("div.description-popup", [
                $el("button.close-button", {
                    innerHTML: "×",
                    onclick: (e) => {
                        e.stopPropagation();
                        popup.remove();
                    }
                }),
                $el("div", {
                    innerHTML: description
                })
            ]);

            // Check if the description contains any media elements
            if (description.includes('<img') || description.includes('<video')) {
                popup.classList.add('has-media');
            }

            // Position popup
            document.body.appendChild(popup);
            const rect = popup.getBoundingClientRect();
            
            // Calculate position
            let left = event.clientX + 10;
            let top = event.clientY + 10;

            // Adjust for screen edges
            if (left + rect.width > window.innerWidth - 20) {
                left = window.innerWidth - rect.width - 20;
            }
            if (top + rect.height > window.innerHeight - 20) {
                top = window.innerHeight - rect.height - 20;
            }

            // Ensure minimum left margin
            left = Math.max(20, left);
            top = Math.max(20, top);

            popup.style.left = `${left}px`;
            popup.style.top = `${top}px`;

            // Stop propagation on popup clicks to prevent closing the main info popup
            popup.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            // Handle outside clicks to close the description popup
            const handleOutsideClick = (e) => {
                if (!popup.contains(e.target) && !e.target.closest('.description-icon')) {
                    popup.remove();
                    document.removeEventListener('click', handleOutsideClick);
                }
            };

            // Small delay to prevent immediate closing
            setTimeout(() => {
                document.addEventListener('click', handleOutsideClick);
            }, 100);

            return popup;
        };

        const createWeightEditor = (lora, contentContainer) => {
            let weight = lora.reco_weight || 1;
            let isEditing = false;
        
            const createWeightDisplay = () => {
                const container = $el("div.weight-container", [
                    $el("h4", { textContent: "Recommended Weight:" })
                ]);
        
                const displayContainer = $el("div.weight-display");
                
                const updateDisplay = () => {
                    // Remove all child elements properly
                    while (displayContainer.firstChild) {
                        displayContainer.removeChild(displayContainer.firstChild);
                    }
                    
                    if (isEditing) {
                        // Show input and save icon
                        const input = $el("input.weight-input", {
                            type: "number",
                            value: weight,
                            step: "0.1",
                            min: "-10",
                            max: "10",
                            onkeydown: (e) => {
                                e.stopPropagation(); // Prevent event bubbling
                                if (e.key === 'Enter') {
                                    handleSave(e.target.value);
                                }
                                if (e.key === 'Escape') {
                                    isEditing = false;
                                    updateDisplay();
                                }
                            },
                            onclick: (e) => e.stopPropagation() // Prevent event bubbling
                        });
        
                        const saveIcon = $el("i.weight-save-icon.pi.pi-check", {
                            onclick: (e) => {
                                e.stopPropagation(); // Prevent event bubbling
                                handleSave(input.value);
                            }
                        });
        
                        displayContainer.appendChild(input);
                        displayContainer.appendChild(saveIcon);
                        
                        // Focus the input
                        setTimeout(() => input.focus(), 0);
                    } else {
                        // Show value and edit icon
                        const valueSpan = $el("span.weight-value", {
                            textContent: weight
                        });
        
                        const editIcon = $el("i.weight-edit-icon.pi.pi-pen-to-square", {
                            onclick: (e) => {
                                e.stopPropagation(); // Prevent event bubbling
                                isEditing = true;
                                updateDisplay();
                            }
                        });
        
                        displayContainer.appendChild(valueSpan);
                        displayContainer.appendChild(editIcon);
                    }
                };
        
                const handleSave = async (newValue) => {
                    const numValue = parseFloat(newValue);
                    if (isNaN(numValue) || numValue < -10 || numValue > 10) {
                        app.ui.dialog.show("Error", "Please enter a valid number between -10 and 10");
                        return;
                    }
                
                    try {
                        const response = await api.fetchApi('/lora_sidebar/update_info', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                id: lora.id,
                                field: 'reco_weight',
                                value: numValue
                            })
                        });
                
                        const result = await response.json();
                        
                        if (result.status === 'success') {
                            // Update local state
                            lora.reco_weight = numValue;
                            weight = numValue;
                            isEditing = false;
                            updateDisplay();
                            
                            // Also update user_edits in local state if it's returned
                            if (result.user_edits) {
                                lora.user_edits = result.user_edits;
                            }
                            this.showToast("success", "Weight Updated", `Recommended weight updated to ${numValue}`);
                        } else {
                            throw new Error(result.message || 'Failed to update weight');
                        }
                    } catch (error) {
                        console.error("Error updating weight:", error);
                        this.showToast("error", "Update Failed", "Failed to update recommended weight");
                        
                        // Revert to previous value in case of error
                        updateDisplay();
                    }
                };
        
                container.appendChild(displayContainer);
                updateDisplay();
                return container;
            };
        
            const weightDisplay = createWeightDisplay();
            
            // Insert weight display after name container but before trained words
            const trainedWords = contentContainer.querySelector('.trained-words');
            if (trainedWords) {
                contentContainer.insertBefore(weightDisplay, trainedWords);
            } else {
                contentContainer.appendChild(weightDisplay);
            }
        };

        // nameContainer creation
        const nameContainer = $el("div.name-container");

        // Create a row for name and icon
        const nameRow = $el("div.name-row", {
            style: {
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                position: 'relative'  // For positioning the save button
            }
        });
        
        // Create editable name element
        const nameElement = $el("h3", { 
            textContent: lora.name, 
            className: "lora-name",
            style: {
                cursor: 'default'
            },
            ondblclick: async (e) => {
                if (e.target !== nameElement) return;
        
                const originalName = lora.name;
                
                // Create container for input and save button
                const editContainer = $el("div", {
                    style: {
                        position: 'relative',
                        width: '100%'
                    },
                    onclick: (e) => e.stopPropagation()  // Prevent clicks from reaching the lora info popup
                });
        
                const input = $el("input", {
                    type: "text",
                    value: originalName,
                    style: {
                        width: '100%',
                        fontSize: '1rem',         // Default font size
                        fontWeight: 'normal',     // Normal weight
                        backgroundColor: '#2a2a2a',
                        border: '1px solid #444',
                        borderRadius: '4px',
                        color: 'inherit',
                        padding: '4px 8px',
                        margin: '0'
                    },
                    onkeydown: async (e) => {
                        e.stopPropagation();
                        if (e.key === 'Escape') {
                            nameElement.textContent = originalName;
                            return;
                        }
                        if (e.key === 'Enter') {
                            await saveName(e.target.value);
                        }
                    },
                    onclick: (e) => e.stopPropagation(),
                    onmousedown: (e) => e.stopPropagation(),
                    onmouseup: (e) => e.stopPropagation()
                });
        
                // Create save button
                const saveButton = $el("div", {
                    style: {
                        position: 'absolute',
                        right: '3px',  // Move slightly inward
                        top: '100%',
                        marginTop: '1px',
                        padding: '1px 3px',  // Much smaller padding
                        backgroundColor: '#333',  // Dark grey background
                        borderRadius: '1px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    },
                    onclick: async (e) => {
                        e.stopPropagation();
                        await saveName(input.value);
                    }
                }, [
                    $el("i.pi.pi-check", {
                        style: {
                            color: '#4CAF50',  // Green checkmark
                            fontSize: '0.8em'  // Smaller icon
                        }
                    })
                ]);
        
                const saveName = async (newValue) => {
                    const newName = newValue.trim();
                    if (newName && newName !== originalName) {
                        try {
                            const response = await api.fetchApi('/lora_sidebar/update_info', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    id: lora.id,
                                    field: 'name',
                                    value: newName
                                })
                            });
        
                            if (response.ok) {
                                lora.name = newName;
                                nameElement.textContent = newName;
                                this.showToast("success", "Updated", "Name updated successfully");
                            } else {
                                throw new Error('Failed to update name');
                            }
                        } catch (error) {
                            console.error("Error updating name:", error);
                            nameElement.textContent = originalName;
                            this.showToast("error", "Update Failed", "Failed to update name");
                        }
                    } else {
                        nameElement.textContent = originalName;
                    }
                };
        
                // Clear the name element and add our container
                nameElement.textContent = '';
                editContainer.appendChild(input);
                editContainer.appendChild(saveButton);
                nameElement.appendChild(editContainer);
                
                // Focus and select the input
                input.focus();
                input.scrollLeft = 0;
                input.setSelectionRange(0, 0);
            }
        });
        
        nameRow.appendChild(nameElement);
        
        // Add description icon separately
        if (lora.model_desc) {
            const descriptionIcon = $el("i.description-icon.pi.pi-info-circle", {
                onclick: (e) => {
                    e.stopPropagation();
                    createDescriptionPopup(lora.model_desc, e);
                }
            });
            nameRow.appendChild(descriptionIcon);
        }
        
        nameContainer.appendChild(nameRow);

        // Add label pills container
        const labelPills = $el("div.label-pills");

        // Add base model pill if available
        if (lora.baseModel) {
            labelPills.appendChild(this.createEditablePill('baseModel', lora.baseModel, lora));
        }

        // Add type pill if available
        if (lora.type) {
            labelPills.appendChild(this.createEditablePill('type', lora.type, lora));
        }
        
        // Only append the labels container if we have pills to show
        if (labelPills.children.length > 0) {
            nameContainer.appendChild(labelPills);
        }

        // Add version information in a version container
        if (lora.versionName || lora.version_desc) {
            const versionContainer = $el("div.version-info");
    
            if (lora.versionName) {
                const versionElement = $el("p", { 
                    textContent: `Version: ${lora.versionName}`, 
                    className: "version-name" 
                });
                versionContainer.appendChild(versionElement);
            }
            
            if (lora.version_desc) {
                // Create a container for the version description
                const versionDescContainer = $el("div", { 
                    className: "version-desc-container",
                    style: {
                        maxHeight: '200px',  // Limit initial height
                        overflowY: 'auto',   // Add scroll if content is too long
                        marginTop: '8px'     // Add some spacing
                    }
                });
        
                // Create the description element that will hold the HTML content
                const versionDescElement = $el("div", { 
                    className: "version-desc",
                    innerHTML: this.sanitizeHTML(lora.version_desc), // Sanitize and set HTML content
                    style: {
                        padding: '4px',
                        fontSize: '0.9em',
                        lineHeight: '1.4'
                    }
                });
        
                // Add expand/collapse functionality if content is long
                versionDescContainer.appendChild(versionDescElement);
                
                // After adding to DOM, check if we need expand/collapse
                setTimeout(() => {
                    if (versionDescElement.scrollHeight > 200) {
                        const expandButton = $el("button", {
                            className: "expand-desc-button",
                            textContent: "Show More",
                            style: {
                                marginTop: '4px',
                                padding: '2px 8px',
                                fontSize: '0.8em',
                                opacity: '0.8'
                            },
                            onclick: (e) => {
                                e.stopPropagation();
                                if (versionDescContainer.style.maxHeight === 'none') {
                                    versionDescContainer.style.maxHeight = '200px';
                                    expandButton.textContent = "Show More";
                                } else {
                                    versionDescContainer.style.maxHeight = 'none';
                                    expandButton.textContent = "Show Less";
                                }
                            }
                        });
                        versionContainer.appendChild(expandButton);
                    }
                }, 0);
                
                versionContainer.appendChild(versionDescContainer);
            }
            
            nameContainer.appendChild(versionContainer);
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

        createWeightEditor(lora, contentContainer);

        // Add trained words
        const trainedWordsContainer = $el("div.trained-words");
        this.createEditableTagSection('trained_words', lora, trainedWordsContainer);
        $el("button.copy-all-button", {
            textContent: "Copy All",
            onclick: () => this.copyToClipboard(updatedLora.trained_words.join(", "))
        })
        contentContainer.appendChild(trainedWordsContainer);

        // Add tags
        const tagsContainer = $el("div.tags");
        this.createEditableTagSection('tags', lora, tagsContainer);
        contentContainer.appendChild(tagsContainer);

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

        const createButtonRow = () => {
            const buttonRow = $el("div.button-row");
        
            // NSFW Toggle Button
            const nsfwButton = $el("button", {
                className: `info-button nsfw-toggle nsfw-${lora.nsfw ? 'true' : 'false'}`,
                title: "NSFW Flag - Green = False, Red = True",
                innerHTML: `<i class="pi ${lora.nsfw ? 'pi-flag-fill' : 'pi-flag'}"></i>`,
                onclick: async (e) => {
                    e.stopPropagation();
                    try {
                        const response = await api.fetchApi('/lora_sidebar/update_info', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                id: lora.id,
                                field: 'nsfw',
                                value: !lora.nsfw
                            })
                        });
            
                        const result = await response.json();
                        
                        if (result.status === 'success') {
                            lora.nsfw = !lora.nsfw;
                            nsfwButton.innerHTML = `<i class="pi ${lora.nsfw ? 'pi-flag-fill' : 'pi-flag'}"></i>`;
                            nsfwButton.className = `info-button nsfw-toggle nsfw-${lora.nsfw ? 'true' : 'false'}`;
                            
                            if (result.user_edits) {
                                lora.user_edits = result.user_edits;
                            }
                            
                            this.showToast("success", "NSFW Flag Updated", `NSFW flag set to ${lora.nsfw}`);
                        } else {
                            throw new Error(result.message || 'Failed to update NSFW flag');
                        }
                    } catch (error) {
                        console.error("Error updating NSFW flag:", error);
                        this.showToast("error", "Update Failed", "Failed to update NSFW flag");
                    }
                }
            });
            buttonRow.appendChild(nsfwButton);
        
            // Upload Image Button
            const uploadButton = $el("button", {
                className: "info-button icon-button",
                title: "Add / Upload Image",
                innerHTML: '<i class="pi pi-camera"></i>',
                onclick: (e) => {
                    e.stopPropagation();
                    this.createUploadPopup(lora);
                }
            });
            buttonRow.appendChild(uploadButton);

            // File Details Button
            const fileDetailsButton = $el("button", {
                className: "info-button icon-button",
                title: "LoRA File Details",
                innerHTML: '<i class="pi pi-file"></i>',
                onclick: (e) => {
                    e.stopPropagation();
                    this.showFileDetails(lora);
                }
            });
            buttonRow.appendChild(fileDetailsButton);

            // Delete button
            const deleteButton = $el("button", {
                className: "info-button icon-button delete-button",
                title: "Remove LoRA",
                innerHTML: '<i class="pi pi-trash"></i>',
                onclick: (e) => {
                    e.stopPropagation();
                    this.confirmDeleteLora(lora);
                }
            });
            buttonRow.appendChild(deleteButton);
        
            return buttonRow;
        };
        
        // Add the button row to the content container (no await needed)
        contentContainer.appendChild(createButtonRow());
    
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
    
        // Close the popup when clicking outside (if persistence is disabled)
        const closePopup = (event) => {
            if (!this.infoPersist && !popup.contains(event.target) && event.target !== iconElement) {
                popup.remove();
                document.removeEventListener("click", closePopup);
                this.currentPopup = null;
            }
        };

        // Only add the click-outside listener if persistence is disabled
        if (!this.infoPersist) {
            setTimeout(() => {
                document.addEventListener("click", closePopup);
            }, 0);
        }

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

    removePreviousPopups() {
        const existingPopups = document.querySelectorAll('.confirm-delete-popup');
        existingPopups.forEach(popup => popup.remove());
    }

    createEditablePill(pillType, value, lora) {
        const isModel = pillType === 'baseModel';
        const field = isModel ? 'baseModel' : 'type';
        let isEditing = false;
    
        // Get autocomplete suggestions from existing data
        const getAutocompleteSuggestions = (input) => {
            const searchTerm = input.toLowerCase();
            const existingValues = new Set(
                this.loraData
                    .map(lora => lora[field])
                    .filter(Boolean) // Remove null/undefined
            );
            return Array.from(existingValues)
                .filter(val => val.toLowerCase().includes(searchTerm));
        };
    
        const pill = $el("span.label-pill", {
            className: `label-pill ${isModel ? 'model' : 'type'}`,
            style: {
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                position: 'relative'
            }
        }, [
            $el("span", { textContent: value }),
            $el("i.pi.pi-pencil", {
                style: {
                    cursor: 'pointer',
                    fontSize: '0.8em',
                    opacity: '0.7'
                },
                onclick: (e) => {
                    e.stopPropagation();
                    if (!isEditing) {
                        isEditing = true;
                        showEditInput();
                    }
                }
            })
        ]);
    
        const showEditInput = () => {
            // Clear the pill content
            while (pill.firstChild) {
                pill.removeChild(pill.firstChild);
            }
    
            // Create autocomplete container
            const autocompleteContainer = $el("div.autocomplete-container", {
                style: {
                    position: 'absolute',
                    top: '100%',
                    left: '0',
                    backgroundColor: '#333',
                    border: '1px solid #444',
                    borderRadius: '4px',
                    width: '100%',
                    maxHeight: '150px',
                    overflowY: 'auto',
                    zIndex: '1000',
                    display: 'none'
                }
            });
    
            const input = $el("input", {
                type: "text",
                value: value,
                style: {
                    width: '100px',
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    padding: '2px',
                    fontSize: 'inherit'
                },
                oninput: (e) => {
                    const suggestions = getAutocompleteSuggestions(e.target.value);
                    updateAutocompleteSuggestions(suggestions);
                },
                onkeydown: async (e) => {
                    if (e.key === 'Escape') {
                        isEditing = false;
                        restorePill();
                        return;
                    }
                    if (e.key === 'Enter' && e.target.value.trim()) {
                        e.preventDefault();
                        try {
                            const response = await api.fetchApi('/lora_sidebar/update_info', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    id: lora.id,
                                    field: field,
                                    value: e.target.value.trim()
                                })
                            });
    
                            if (response.ok) {
                                value = e.target.value.trim();
                                lora[field] = value;
                                isEditing = false;
                                restorePill();
                                this.showToast("success", "Updated", `Updated ${isModel ? 'model' : 'type'}`);
                            }
                        } catch (error) {
                            console.error("Error updating:", error);
                            this.showToast("error", "Update Failed", "Failed to update");
                        }
                    }
                }
            });
    
            const saveIcon = $el("i.weight-save-icon.pi.pi-check", {
                style: {
                    cursor: 'pointer',
                    marginLeft: '5px'
                },
                onclick: () => {
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
                }
            });
    
            const updateAutocompleteSuggestions = (suggestions) => {
                autocompleteContainer.innerHTML = '';
                if (suggestions.length > 0) {
                    suggestions.forEach(suggestion => {
                        const item = $el("div.autocomplete-item", {
                            textContent: suggestion,
                            style: {
                                padding: '5px 10px',
                                cursor: 'pointer',
                                hover: {
                                    backgroundColor: '#444'
                                }
                            },
                            onclick: () => {
                                input.value = suggestion;
                                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
                            }
                        });
                        autocompleteContainer.appendChild(item);
                    });
                    autocompleteContainer.style.display = 'block';
                } else {
                    autocompleteContainer.style.display = 'none';
                }
            };
    
            const restorePill = () => {
                while (pill.firstChild) {
                    pill.removeChild(pill.firstChild);
                }
                pill.appendChild($el("span", { textContent: value }));
                pill.appendChild($el("i.pi.pi-pencil", {
                    style: {
                        cursor: 'pointer',
                        fontSize: '0.8em',
                        opacity: '0.7'
                    },
                    onclick: (e) => {
                        e.stopPropagation();
                        if (!isEditing) {
                            isEditing = true;
                            showEditInput();
                        }
                    }
                }));
            };
    
            pill.appendChild(input);
            pill.appendChild(saveIcon);
            pill.appendChild(autocompleteContainer);
            
            // Focus input after appending
            setTimeout(() => input.focus(), 0);
    
            // Click outside to close autocomplete
            document.addEventListener('click', (e) => {
                if (!pill.contains(e.target)) {
                    autocompleteContainer.style.display = 'none';
                }
            });
        };
    
        return pill;
    }

    createEditableTagSection(type, lora, container) {
        const isTrainedWords = type === 'trained_words';
        const title = isTrainedWords ? "Trained Words:" : "Tags:";
        const items = lora[type] || [];
        let isEditing = false;
    
        const updateSection = (newItems) => {
            while (container.firstChild) {
                container.removeChild(container.firstChild);
            }
    
            // Create header with edit/save button
            const header = $el("div.section-header", {
                style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '5px'
                }
            }, [
                $el("h4", { textContent: title }),
                $el("i", {
                    className: `weight-${isEditing ? 'save' : 'edit'}-icon pi pi-${isEditing ? 'check' : 'pen-to-square'}`,
                    style: {
                        cursor: 'pointer',
                        fontSize: '0.9em'
                    },
                    onclick: (e) => {
                        e.stopPropagation();
                        isEditing = !isEditing;
                        updateSection(items);
                    }
                })
            ]);
            container.appendChild(header);
    
            if (isEditing) {
                // Edit mode
                const editContainer = $el("div.edit-container", {
                    style: {
                        marginBottom: '10px'
                    }
                });
    
                // Input field with add button
                const inputGroup = $el("div.input-group", {
                    style: {
                        display: 'flex',
                        gap: '5px',
                        marginBottom: '10px'
                    }
                }, [
                    $el("input", {
                        type: "text",
                        placeholder: `Add new ${isTrainedWords ? 'trigger word' : 'tag'}...`,
                        onkeydown: async (e) => {
                            if (e.key === 'Escape') {
                                isEditing = false;
                                updateSection(items);
                                return;
                            }
                            if (e.key === 'Enter' && e.target.value.trim()) {
                                e.preventDefault();
                                const newItem = e.target.value.trim();
                                if (!items.includes(newItem)) {
                                    try {
                                        const response = await api.fetchApi('/lora_sidebar/update_info', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                id: lora.id,
                                                field: type,
                                                value: [...items, newItem]
                                            })
                                        });
    
                                        if (response.ok) {
                                            items.push(newItem);
                                            e.target.value = '';
                                            updateSection(items);
                                            this.showToast("success", "Updated", `Added new ${isTrainedWords ? 'trigger word' : 'tag'}`);
                                        }
                                    } catch (error) {
                                        console.error("Error updating:", error);
                                        this.showToast("error", "Update Failed", "Failed to update");
                                    }
                                }
                            }
                        }
                    }),
                    $el("i.pi.pi-plus", {
                        style: {
                            cursor: 'pointer',
                            padding: '5px',
                            color: '#4CAF50',
                            fontSize: '1em'
                        },
                        onclick: (e) => {
                            const input = e.target.previousElementSibling;
                            if (input.value.trim()) {
                                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
                            }
                        }
                    })
                ]);
                editContainer.appendChild(inputGroup);

                // Add focus after appending
                setTimeout(() => {
                    const input = inputGroup.querySelector('input');
                    if (input) input.focus();
                }, 0);
    
                // Current items with delete buttons
                const itemsContainer = $el("div.word-pills", {
                    style: {
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '5px'
                    }
                });
    
                items.forEach(item => {
                    const pillContainer = $el("div.pill-container", {
                        style: {
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px'
                        }
                    }, [
                        $el("span.word-pill", { 
                            textContent: item,
                            onclick: () => this.copyToClipboard(item)
                        }),
                        $el("i.pi.pi-times", {
                            style: {
                                cursor: 'pointer',
                                color: '#ff4444',
                                fontSize: '0.8em'
                            },
                            onclick: async (e) => {
                                e.stopPropagation();
                                try {
                                    const response = await api.fetchApi('/lora_sidebar/update_info', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            id: lora.id,
                                            field: type,
                                            value: items.filter(i => i !== item)
                                        })
                                    });
    
                                    if (response.ok) {
                                        items.splice(items.indexOf(item), 1);
                                        updateSection(items);
                                        this.showToast("success", "Updated", `Removed ${isTrainedWords ? 'trigger word' : 'tag'}`);
                                    }
                                } catch (error) {
                                    console.error("Error updating:", error);
                                    this.showToast("error", "Update Failed", "Failed to update");
                                }
                            }
                        })
                    ]);
                    itemsContainer.appendChild(pillContainer);
                });
    
                editContainer.appendChild(itemsContainer);
                container.appendChild(editContainer);
            } else {
                // Display mode
                const itemsContainer = $el("div.word-pills", 
                    items.length > 0 
                        ? items.map(item => 
                            $el("span.word-pill", { 
                                textContent: item,
                                onclick: () => this.copyToClipboard(item)
                            })
                        )
                        : [$el("span", { textContent: "None", className: "no-tags" })]
                );
                container.appendChild(itemsContainer);

                // Only add the Copy All button for trained words section when there are items
                if (type === 'trained_words' && items.length > 0) {
                    const copyAllButton = $el("button.copy-all-button", {
                        textContent: "Copy All",
                        onclick: () => this.copyToClipboard(items.join(", "))
                    });
                    container.appendChild(copyAllButton);
                }
            }
        };
    
        updateSection(items);
        return container;
    }

    async handleLastGeneratedImage(lora) {
        try {
            // Get the latest temp image info
            const response = await fetch('/lora_sidebar/latest_temp_image');
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to get latest generated image');
            }
            
            const imageInfo = await response.json();
            
            // Use the existing upload endpoint with the URL
            const uploadResponse = await fetch('/lora_sidebar/upload_images', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    lora_id: lora.id,
                    urls: [imageInfo.url]  // Using the existing URL format
                })
            });
    
            const result = await uploadResponse.json();
            
            if (result.status === 'success') {
                // Update the lora object with new images
                lora.images = lora.images || [];
                lora.images.push(...result.images);
                
                // Refresh the info popup if it's open
                const infoPopup = document.querySelector('.model-info-popup');
                if (infoPopup) {
                    this.showLoraInfo(lora, null);
                }
                
                this.showToast("success", "Image Added", "Last generated image added successfully");
                return true;
            } else {
                throw new Error(result.message || 'Failed to add image');
            }
        } catch (error) {
            debug.log("Error adding last generated image:", error);
            this.showToast("error", "Add Failed", error.message || "No generated images found");
            return false;
        }
    }

    async showFileDetails(lora) {
        this.removePreviousPopups();

        try {
            const fullPath = lora.path || "";
            const directory = fullPath.substring(0, fullPath.lastIndexOf('\\'));
            const filename = fullPath.substring(fullPath.lastIndexOf('\\') + 1);
            const response = await api.fetchApi(`/lora_sidebar/file_details/${lora.id}`);
            const result = await response.json();
    
            // Helper function to create a label with buttons
            const createLabelWithCopy = (labelText, contentToCopy, canOpenFolder = false) => {
                return $el("p.file-location-label", [
                    $el("span", { textContent: labelText }),
                    $el("div.action-buttons", {
                        style: {
                            marginLeft: "8px",
                            display: "inline-flex",
                            gap: "8px"
                        }
                    }, [
                        // Existing copy button
                        $el("i.pi.pi-clipboard", {
                            style: {
                                cursor: "pointer",
                                fontSize: "0.9em",
                                opacity: "0.7"
                            },
                            onclick: (e) => {
                                e.stopPropagation();
                                this.copyToClipboard(contentToCopy);
                            }
                        }),
                        // New folder open button - only show for directory paths
                        canOpenFolder && $el("i.pi.pi-folder-open", {
                            style: {
                                cursor: "pointer",
                                fontSize: "0.9em",
                                opacity: "0.7"
                            },
                            title: "Open in file browser",
                            onclick: async (e) => {
                                e.stopPropagation();
                                try {
                                    const response = await fetch('/lora_sidebar/open_folder', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ path: contentToCopy })
                                    });
                                    
                                    if (!response.ok) {
                                        // Fallback to copy if opening fails
                                        this.copyToClipboard(contentToCopy);
                                        this.showToast("info", "Copied Instead", 
                                            "Couldn't open folder, path copied to clipboard instead.");
                                    }
                                } catch (error) {
                                    // Fallback to copy on error
                                    this.copyToClipboard(contentToCopy);
                                    this.showToast("info", "Copied Instead", 
                                        "Couldn't open folder, path copied to clipboard instead.");
                                }
                            }
                        })
                    ].filter(Boolean))  // Remove null items (when canOpenFolder is false)
                ]);
            };
        
            const detailsPopup = $el("div.confirm-delete-popup", {
                onclick: (e) => e.stopPropagation()
            }, [
                $el("h3", {
                    textContent: "LoRA File Details",
                    style: {
                        margin: "0 0 15px 0"
                    }
                }),
                // Source Location
                createLabelWithCopy("Source Location:", directory, true),
                $el("p", {
                    className: "file-location",
                    textContent: directory || "Path not available"
                }),
                
                // Source File
                createLabelWithCopy("Source File:", filename),
                $el("p", {
                    className: "file-location",
                    textContent: filename || "Filename not available"
                }),
                
                // Managed Location
                createLabelWithCopy("Managed Location:", result.managed_dir, true),
                $el("p", {
                    className: "file-location",
                    textContent: result.managed_dir || "Path not available"
                }),
        
                $el("div.confirm-buttons", [
                    $el("button", {
                        textContent: "Close",
                        onclick: (e) => {
                            e.stopPropagation();
                            document.body.removeChild(detailsPopup);
                        }
                    })
                ])
            ]);
        
            document.body.appendChild(detailsPopup);

            const handleOutsideClick = (e) => {
                if (!detailsPopup.contains(e.target)) {
                    e.stopPropagation();
                    // Check if popup still exists and is a child of document.body
                    if (document.body.contains(detailsPopup)) {
                        document.body.removeChild(detailsPopup);
                    }
                    document.removeEventListener('click', handleOutsideClick);
                }
            };

            // Small delay to prevent immediate closing
            setTimeout(() => {
                document.addEventListener('click', handleOutsideClick);
            }, 0);

        } catch (error) {
            console.error("Error fetching file details:", error);
            this.showToast("error", "Error", "Failed to fetch file details");
        }
    }

    confirmDeleteLora(lora) {
        this.removePreviousPopups();

        const confirmPopup = $el("div.confirm-delete-popup", {
            onclick: (e) => e.stopPropagation()
        }, [
            $el("p", {
                textContent: "Are you sure you want to delete the sidebar data for this LoRA? This won't remove the LoRA or local data from your hard drive."
            }),
            $el("div.confirm-buttons", [
                $el("button", {
                    textContent: "Cancel",
                    onclick: (e) => {
                        e.stopPropagation();
                        document.body.removeChild(confirmPopup);
                    }
                }),
                $el("button", {
                    textContent: "Delete",
                    onclick: (e) => {
                        e.stopPropagation();
                        this.deleteLora(lora);
                    }
                })
            ])
        ]);
        document.body.appendChild(confirmPopup);

        const handleOutsideClick = (e) => {
            if (!confirmPopup.contains(e.target)) {
                e.stopPropagation();
                // Check if popup still exists and is a child of document.body
                if (document.body.contains(confirmPopup)) {
                    document.body.removeChild(confirmPopup);
                }
                document.removeEventListener('click', handleOutsideClick);
            }
        };

        // Small delay to prevent immediate closing
        setTimeout(() => {
            document.addEventListener('click', handleOutsideClick);
        }, 0);
    }

    createUploadPopup(lora) {
        // Remove any existing popups
        this.removePreviousPopups();
    
        // Create file input element (hidden)
        const fileInput = $el("input", {
            type: "file",
            multiple: true,
            accept: "image/*",
            style: { display: "none" },
            onchange: (e) => {
                const files = Array.from(e.target.files);
                if (files.length > 0) {
                    filePathInput.value = files.map(f => f.name).join(", ");
                    // Clear the error message if it exists
                    const errorMsg = popup.querySelector('.error-message');
                    if (errorMsg) errorMsg.remove();
                }
            }
        });
    
        // Create text input for file path
        const filePathInput = $el("input", {
            type: "text",
            placeholder: "Select images, enter file path, or paste image URL...",
            className: "file-path-input",
            style: {
                width: "100%",
                padding: "8px",
                marginBottom: "15px",
                backgroundColor: "#2a2a2a",
                border: "1px solid #444",
                borderRadius: "4px",
                color: "inherit"
            }
        });
    
        // Create the popup
        const popup = $el("div.confirm-delete-popup", {
            onclick: (e) => e.stopPropagation(),
            style: {
                width: "400px",
                padding: "20px"
            }
        }, [
            $el("h3", { 
                textContent: "Add Images",
                style: { 
                    marginTop: "0",
                    marginBottom: "15px",
                    textAlign: "center" 
                }
            }),
            $el("p", { 
                textContent: "Select one or more local images to add to the carousel. You can also paste an image URL.",
                style: { 
                    marginBottom: "15px",
                    textAlign: "center",
                    color: "#999",
                    fontSize: "0.9em"
                }
            }),
            filePathInput,
            // Action buttons container
            $el("div.action-buttons", {
                style: {
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "10px",
                    marginBottom: "20px"
                }
            }, [
                $el("button", {
                    textContent: "Browse Files...",
                    className: "confirm-button",
                    style: {
                        minWidth: "200px"
                    },
                    onclick: () => fileInput.click()
                }),
                $el("button", {
                    className: "confirm-button",
                    style: {
                        minWidth: "200px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                        height: "32px",  // Match confirm button height
                        borderRadius: "6px",  // More rounded
                    },
                    onclick: async (e) => {
                        e.stopPropagation();
                        const button = e.target.closest('button');  // Get the button element even if icon was clicked
                        const originalHtml = button.innerHTML;
                        
                        button.disabled = true;
                        button.textContent = "Adding...";
                        
                        try {
                            const success = await this.handleLastGeneratedImage(lora);
                            if (success) {
                                popup.remove();
                            }
                        } finally {
                            button.disabled = false;
                            button.innerHTML = originalHtml;
                        }
                    }
                }, [
                    $el("i.pi.pi-microchip-ai", {
                        style: {
                            fontSize: "16px"  // Adjust icon size as needed
                        }
                    }),
                    $el("span", { textContent: "Add Last Generated Image" })
                ])
            ]),
            // Confirm/Cancel buttons at bottom
            $el("div.confirm-buttons", {
                style: {
                    display: "flex",
                    justifyContent: "center",
                    gap: "10px"
                }
            }, [
                $el("button", {
                    textContent: "Cancel",
                    onclick: () => popup.remove(),
                    style: {
                        minWidth: "100px" // Consistent width for bottom buttons
                    }
                }),
                $el("button", {
                    textContent: "Upload",
                    onclick: async () => {
                        const files = fileInput.files;
                        const inputText = filePathInput.value.trim();
    
                        // Check for URLs
                        if (inputText && !files?.length) {
                            const urls = inputText.split(/[\n,]/).map(url => url.trim()).filter(url => url);
                            const validUrls = urls.filter(url => isValidUrl(url));
    
                            if (validUrls.length === 0) {
                                showError("Please enter valid image URLs or select local files");
                                return;
                            }
    
                            try {
                                const response = await fetch('/lora_sidebar/upload_images', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({
                                        lora_id: lora.id,
                                        urls: validUrls
                                    })
                                });
    
                                const result = await response.json();
                                
                                if (result.status === 'success') {
                                    handleUploadSuccess(result);
                                } else {
                                    throw new Error(result.message || 'Upload failed');
                                }
                            } catch (error) {
                                console.error("Error uploading URLs:", error);
                                this.showToast("error", "Upload Failed", error.message);
                            } finally {
                                popup.remove();
                            }
                            return;
                        }
    
                        // Handle local files
                        if (!files || files.length === 0) {
                            showError("Please select at least one image or enter valid URLs");
                            return;
                        }
    
                        const formData = new FormData();
                        formData.append('lora_id', lora.id);
                        
                        for (const file of files) {
                            formData.append('files[]', file);
                        }
    
                        try {
                            const response = await fetch('/lora_sidebar/upload_images', {
                                method: 'POST',
                                body: formData
                            });
    
                            const result = await response.json();
                            
                            if (result.status === 'success') {
                                handleUploadSuccess(result);
                            } else {
                                throw new Error(result.message || 'Upload failed');
                            }
                        } catch (error) {
                            console.error("Error uploading files:", error);
                            this.showToast("error", "Upload Failed", error.message);
                        } finally {
                            popup.remove();
                        }
                    },
                    style: {
                        minWidth: "100px"
                    }
                })
            ])
        ]);
    
        const showError = (message) => {
            // Remove existing error message if any
            const existingError = popup.querySelector('.error-message');
            if (existingError) existingError.remove();
    
            // Add new error message
            const errorMsg = $el("p.error-message", {
                textContent: message,
                style: {
                    color: "#ff4444",
                    marginTop: "5px",
                    fontSize: "0.9em",
                    textAlign: "center"
                }
            });
            popup.insertBefore(errorMsg, popup.querySelector('.confirm-buttons'));
        };
    
        const handleUploadSuccess = (result) => {
            lora.images = lora.images || [];
            lora.images.push(...result.images);
            
            const infoPopup = document.querySelector('.model-info-popup');
            if (infoPopup) {
                this.showLoraInfo(lora, null);
            }
            
            this.showToast("success", "Upload Complete", result.message);
        };

        // outside click handler
        const handleOutsideClick = (e) => {
            if (!popup.contains(e.target)) {
                e.stopPropagation();
                if (document.body.contains(popup)) {
                    document.body.removeChild(popup);
                }
                document.removeEventListener('click', handleOutsideClick);
            }
        };
    
        document.body.appendChild(popup);

        // Small delay to prevent immediate closing
        setTimeout(() => {
            document.addEventListener('click', handleOutsideClick);
        }, 0);

        fileInput.addEventListener('change', () => {
            const files = fileInput.files;
            if (files.length > 0) {
                filePathInput.value = Array.from(files).map(f => f.name).join(", ");
            }
        });
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

    updateSortMethod(newVal) {
        this.SorthMethod = newVal;
    }

    updateCatNew(newVal) {
        this.CatNew = newVal;
    }

    updateNSFWfolder(newVal) {
        this.nsfwFolder = newVal;
    }

    updateCategoryState(newVal) {
        this.defaultCatState = newVal === "Expanded";
    }

    updateInfoPersist(newVal) {
        this.infoPersist = newVal;
    }

    updateBatchSize(newVal) {
        this.batchSize = newVal;
    }

    updateFavState(newVal) {
        this.favState = newVal;
    }

    updateA1111Style(newVal) {
        this.a1111Style = newVal;
    }

    updateUseRG3(newVal) {
        this.UseRG3 = newVal;
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
            options: ['All', 'Pony', 'Flux', 'SD 3.5', 'Illustrious', 'SDXL', 'SD1.5', 'Other'],
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
            id: "LoRA Sidebar.General.infoPersist",
            name: "Keep LoRA Info Open",
            tooltip : 'Keeps the LoRA Info Window Open Unless Manually Closed',
            type: "boolean",
            defaultValue: true,
            onChange: (newVal, oldVal) => {
                if (app.loraSidebar && oldVal !== undefined) {
                    app.loraSidebar.updateInfoPersist(newVal);
                }
            }
        });

        app.ui.settings.addSetting({
            id: "LoRA Sidebar.General.a1111Style",
            name: "Use A1111 Lora Prompting",
            tooltip : 'If enabled, will add LoRA and Weight before trained words on drag and drop onto prompt nodes',
            type: "boolean",
            defaultValue: false,
            onChange: (newVal, oldVal) => {
                if (app.loraSidebar && oldVal !== undefined) {
                    app.loraSidebar.updateA1111Style(newVal);
                }
            }
        });

        app.ui.settings.addSetting({
            id: "LoRA Sidebar.General.useRG3",
            name: "Use rgthree Nodes",
            tooltip : 'Creates a Lora Power Loader Node on drag and drop vs a core node',
            type: "boolean",
            defaultValue: false,
            onChange: (newVal, oldVal) => {
                if (app.loraSidebar && oldVal !== undefined) {
                    app.loraSidebar.updateUseRG3(newVal);
                }
            }
        });

        app.ui.settings.addSetting({
            id: "LoRA Sidebar.General.catNew",
            name: "Use New Category",
            tooltip : 'Automatically sorts recently added LoRAs into a special category',
            type: "boolean",
            defaultValue: true,
            onChange: (newVal, oldVal) => {
                if (app.loraSidebar && oldVal !== undefined) {
                    app.loraSidebar.updateCatNew(newVal);
                }
            }
        });

        app.ui.settings.addSetting({
            id: "LoRA Sidebar.General.sortMethod",
            name: "Sort LoRAs By",
            tooltip : 'How LoRAs will be sorted, for this change to take effect (for now) please refresh the broswer',
            type: 'combo',
            options: ['AlphaAsc', 'DateNewest', 'AlphaDesc', 'DateOldest'],
            defaultValue: 'AlphaAsc',
            onChange: (newVal, oldVal) => {
                if (app.loraSidebar && oldVal !== undefined) {
                    app.loraSidebar.updateSortMethod(newVal);
                }
            }
        });

        app.ui.settings.addSetting({
            id: "LoRA Sidebar.General.sortModels",
            name: "Categorize LoRAs By",
            tooltip : 'Subdir uses your directory structure, Tags use model tags, either Custom or from CivitAI',
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
            name: "Category Tags to Use",
            tooltip : 'Custom will use tags frm the setting above. CivitAI uses the main site categories like Character, Clothing, Poses, etc.',
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
            tooltip : 'Only used when sort is set to Tags and Tags is set to Custom. A comma seperated list of tags used to create categories, each Lora will only be assigned one category',
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

        app.ui.settings.addSetting({
            id: "LoRA Sidebar.NSFW.nsfwFolder",
            name: "Use NSFW Folders",
            tooltip : 'Flags LoRAs as NSFW if they are in a folder containing "NSFW" (Ignores saved NSFW Flags)',
            type: "boolean",
            defaultValue: true,
            onChange: (newVal, oldVal) => {
                if (app.loraSidebar && oldVal !== undefined) {
                    app.loraSidebar.updateNSFWfolder(newVal);
                }
            }
        });
    },
});