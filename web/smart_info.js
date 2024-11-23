import { app } from "../../scripts/app.js";

var debug = {
    enabled: false,
    log: function(...args) {
        if (this.enabled) {
            console.log(...args);
        }
    }
};

class LoraSmartInfo {
    constructor(loraSidebar) {
        this.sidebar = loraSidebar;
        this.app = loraSidebar.app;

        this.enabled = this.app.ui.settings.getSettingValue("LoRA Sidebar.Smart Info.smartEnabled", true);
        this.showSidebar = this.app.ui.settings.getSettingValue("LoRA Sidebar.Smart Info.showSidebar", true);
        this.showTrained = this.app.ui.settings.getSettingValue("LoRA Sidebar.Smart Info.showTrained", true);
        this.zoomLevel = this.app.ui.settings.getSettingValue("LoRA Sidebar.Smart Info.zoomLevel", 0.5);
        this.showMenu = this.app.ui.settings.getSettingValue("LoRA Sidebar.Smart Info.showMenu", true);
        this.showCanvas = this.app.ui.settings.getSettingValue("LoRA Sidebar.Smart Info.showCanvas", true);

        this.loraData = loraSidebar.loraData;
        this.currentHoverTimer = null;
        this.hoverDelay = 500;
        this.lastWidget = null;
        this.lastNode = null;
        this.lastLoraValue = null;
        this.hasShownSidebarWarning = false;
        this.menuObserver = null;
        this.menuDebounceTimer = null;
        this.menuDebounceDelay = 50;
        this.comfyClickHandler = null;  // handler reference
        this.listenerActive = false;  // Track listener state
        this.graphMonitorInitialized = false;
        this.menuObserverInitialized = false;

        if (this.enabled) {
            this.sidebar.showToast(
                "info", 
                "Smart LoRA Info Active",
                "Automatic LoRA Previews & Info will be displayed. (Customize this in LoRA Sidebar Settings)"
            );
            if (this.app.graph) {
                this.setupGraphMonitor();
                this.graphMonitorInitialized = true;
            }
            
            // Set up observer for menu entries
            this.setupMenuObserver();
            this.menuObserverInitialized = true;
        }
        // global toggle
        this.updateSettings(this.enabled);
    }

    updateSettings(newEnabled) {
        this.enabled = newEnabled;
        if (!this.enabled) {
            // If master toggle is off, disable all runtime features
            this.showSidebar = false;
            this.showTrained = false;
            this.showMenu = false;
            this.showCanvas = false;
        } else {
            // If enabled, restore user settings
            this.showSidebar = this.app.ui.settings.getSettingValue("LoRA Sidebar.Smart Info.showSidebar", true);
            this.showTrained = this.app.ui.settings.getSettingValue("LoRA Sidebar.Smart Info.showTrained", true);
            this.showMenu = this.app.ui.settings.getSettingValue("LoRA Sidebar.Smart Info.showMenu", true);
            this.showCanvas = this.app.ui.settings.getSettingValue("LoRA Sidebar.Smart Info.showCanvas", true);
            if (this.app.graph && !this.graphMonitorInitialized) {
                this.setupGraphMonitor();
                this.graphMonitorInitialized = true;
            }
            
            // Set up observer for menu entries
            if (!this.menuObserverInitialized) {
                this.setupMenuObserver();
                this.menuObserverInitialized = true;
            }
        }
     }

    isSidebarOpen() {
        // Skip check if feature is disabled
        if (!this.showSidebar) return false;

        const sidebarContent = document.querySelector('.lora-sidebar-content');
        if (!sidebarContent) return false;

        const style = window.getComputedStyle(sidebarContent);
        const isVisible = style.display !== 'none' && 
                         style.visibility !== 'hidden' && 
                         style.opacity !== '0';

        // Also check if our data is loaded
        const hasData = this.sidebar?.loraData?.length > 0;

        return isVisible && hasData;
    }

    setupComfyListeners() {
        if (this.listenerActive) {
            debug.log("Listeners already active, skipping setup");
            return;
        }
    
        this.comfyClickHandler = (e) => {
            // Debug what was clicked
            debug.log("Click target:", e.target);
            
            // Look for any comfy elements
            if (e.target.matches('[class*="comfyui-body"]') || 
                e.target.closest('[class*="comfyui-body"]')) {
                debug.log("Comfy element clicked:", e.target);
                if (this.lastNodePreviewClear) {
                    this.lastNodePreviewClear();
                    this.lastNodePreviewClear = null;
                    this.lastNode = null;
                    this.lastLoraValue = null;
                }
            }
        };
        
        document.addEventListener('click', this.comfyClickHandler, true);
        this.listenerActive = true;
        debug.log("Comfy UI listeners added to document");
    }
    
    removeComfyListeners() {
        if (this.listenerActive && this.comfyClickHandler) {
            document.removeEventListener('click', this.comfyClickHandler, true);
            this.comfyClickHandler = null;
            this.listenerActive = false;
            debug.log("Comfy UI listeners removed from document");
        }
    }

    isEnabled() {
        // Check current setting value
        return this.app.ui.settings.getSettingValue("LoRA Sidebar.General.smartHover", true);
    }

    async showPreviewOnCanvas(loraName, x, y, menuElement, nodeHeight, canvasScale) {
        // Skip check if feature is disabled
        if (!this.showCanvas) return false;

        debug.log("1. Starting preview for:", loraName);
        try {

            // NODE PATH
            if (!menuElement || !menuElement.appendChild) {

                // Check if we already have a node preview with this ID
                const existingPreview = document.querySelector(`[data-lora-preview="${loraName}"]`);
                if (existingPreview) {
                    return () => {}; // Return empty cleanup if already showing
                }

                // I HATE LISTENERS
                this.setupComfyListeners();

                const overlay = document.createElement('div');
                overlay.className = 'litemenu-entry preview-container';
                overlay.setAttribute('data-lora-preview', loraName);
                overlay.style.position = 'fixed';
                overlay.style.pointerEvents = 'none';
                overlay.style.zIndex = '9999';
                overlay.style.background = 'rgba(0,0,0,0.75)';
                overlay.style.padding = '2px';
                document.body.appendChild(overlay);

                const response = await fetch(`/lora_sidebar/preview/${encodeURIComponent(loraName)}`);
                if (!response.ok) return;
                const img = new Image();
                img.src = URL.createObjectURL(await response.blob());
                
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                });

                const maxSize = 256;
                const scale = Math.min(maxSize / img.width, maxSize / img.height);
                const width = img.width * scale;
                const height = img.height * scale;

                // Adjust the position based on the image size to make sure it's placed correctly
                // For example, placing it to the left of the node and centered vertically
                let scaledWidth = width;
                let scaledHeight = height;

                // scale down
                if (nodeHeight !== null && nodeHeight < height){
                    const scale = (nodeHeight / maxSize);
                    scaledHeight = scale * height;
                    scaledWidth = scale * width;
                }

                //scale up
                if (nodeHeight !== null && nodeHeight > height){
                    const extraHeight = nodeHeight - height;
                    const scale = 1 + (0.5 * extraHeight) / height;
                    scaledHeight = scale * height;
                    scaledWidth = scale * width;
                }

                // Now position relative to the passed-in coordinates
                const padding = 2;
                const adjustedX = x - scaledWidth - padding;  // Place to the left of the node
                const adjustedY = y - (scaledHeight / 2) - (30 * canvasScale);     // Center vertically on the node

                debug.log("Setting node preview position:", {x, y});

                // Direct positioning using passed coordinates
                overlay.style.left = `${adjustedX}px`;
                overlay.style.top = `${adjustedY}px`;
                overlay.style.width = `${scaledWidth}px`;
                overlay.style.height = `${scaledHeight}px`;

                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'contain';
                overlay.appendChild(img);

                // Add trained words if image is big enough
                if (this.showTrained && scaledWidth >= maxSize * 0.2) {
                    try {
                        const infoResponse = await fetch(`/lora_sidebar/info/${encodeURIComponent(loraName)}`);
                        if (infoResponse.ok) {
                            const data = await infoResponse.json();
                            if (data.status === "success" && 
                                data.info?.trained_words?.length > 0) {
                                const textElement = document.createElement('div');
                                textElement.className = 'lora-preview-text';
                                textElement.style.color = 'white';
                                textElement.style.fontSize = '12px';
                                textElement.style.textAlign = 'center';
                                textElement.style.background = 'rgba(0,0,0,0.75)';
                                textElement.style.padding = '2px 4px';
                                textElement.style.marginTop = '2px';
                                textElement.style.maxWidth = `${scaledWidth}px`;
                                textElement.style.wordWrap = 'break-word';
                                textElement.style.pointerEvents = 'all';
                                textElement.style.userSelect = 'text';
                                textElement.style.cursor = 'text';
                                // Make sure clicks don't propagate up
                                textElement.addEventListener('click', e => e.stopPropagation());
                                textElement.addEventListener('mousedown', e => e.stopPropagation());
                                textElement.textContent = data.info.trained_words[0];
                                overlay.appendChild(textElement);
                            }
                        }
                    } catch (error) {
                        console.debug("Failed to fetch LoRA info:", error);
                    }
                }

                return () => {
                    if (overlay && overlay.parentElement) {
                        overlay.parentElement.removeChild(overlay);
                    }
                    self.lastNode = null;
                    self.lastLoraValue = null;
                    this.removeComfyListeners();
                };
            }

            // MENU PATH
            if (this.showMenu) {
            
                if (!menuElement.previewElement) {
                    menuElement.previewElement = document.createElement('div');
                    menuElement.previewElement.className = 'litemenu-entry preview-container';
                    menuElement.previewElement.style.position = 'absolute';
                    menuElement.previewElement.style.pointerEvents = 'none';
                    menuElement.appendChild(menuElement.previewElement);
                }

                // Fetch and load image
                const response = await fetch(`/lora_sidebar/preview/${encodeURIComponent(loraName)}`);
                if (!response.ok) return;

                const img = new Image();
                img.src = URL.createObjectURL(await response.blob());
                
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                });

                // Calculate sizes
                const maxSize = 512;
                const scale = Math.min(maxSize / img.width, maxSize / img.height);
                const width = img.width * scale;
                const height = img.height * scale;

                // Get menu position
                const menuRect = menuElement.getBoundingClientRect();
                const padding = 20;
                const windowHeight = window.innerHeight;
                
                // Position to left of menu
                menuElement.previewElement.style.left = `-${width + padding}px`;
                
                // Center in visible area or window, whichever is smaller
                const visibleMenuHeight = Math.min(menuRect.height, windowHeight);
                const topOffset = (visibleMenuHeight - height) / 2;
                
                // Clamp to ensure it stays in view
                const clampedTop = Math.max(0, Math.min(topOffset, visibleMenuHeight - height));
                menuElement.previewElement.style.top = `${clampedTop}px`;

                menuElement.previewElement.style.width = `${width}px`;
                menuElement.previewElement.style.height = `${height}px`;
                menuElement.previewElement.style.background = 'rgba(0,0,0,0.8)';
                menuElement.previewElement.style.padding = '5px';

                // Set image to fill container
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'contain';

                // Clear any existing content
                menuElement.previewElement.innerHTML = '';
                menuElement.previewElement.appendChild(img);

                // Make visible
                menuElement.previewElement.style.display = 'block';

                return () => {
                    if (menuElement.previewElement) {
                        menuElement.previewElement.style.display = 'none';
                        menuElement.previewElement.innerHTML = '';
                    }
                    this.removeComfyListeners();
                };
            }

        } catch (error) {
            this.removeComfyListeners();
            console.error("Error showing preview:", error);
            return null;
        }
    }

    setupGraphMonitor() {

        if (!this.enabled || !this.showCanvas) return;

        const self = this;
        const origNodeMouse = LGraphCanvas.prototype.processNodeWidgets;
        const origShowMenu = LGraphCanvas.prototype.showContextMenu;
    
        if (!origNodeMouse) return;

        debug.log("Current app:", this.app);
        debug.log("Graph:", this.app.graph);
        debug.log("Canvas:", this.app.canvas);

        // Get actual LGraphCanvas instance
        const actualCanvas = this.app.canvas;

        debug.log("Is LGraphCanvas?", actualCanvas instanceof LGraphCanvas);
        debug.log("Canvas properties:", Object.keys(actualCanvas));
        debug.log("Canvas:", actualCanvas);

        // Add canvas click handler
        actualCanvas.onMouseDown = function(event) {
            this.adjustMouseEvent(event);
            
            // If clicked on empty canvas, clear any preview
            const node = this.graph.getNodeOnPos(event.canvasX, event.canvasY);
            if (!node && self.lastNodePreviewClear) {
                debug.log("Canvas click detected, clearing preview");
                self.lastNodePreviewClear();
                self.lastNodePreviewClear = null;
                self.lastNode = null;
                self.lastLoraValue = null;
            }
            return true;
        };

        // Create proxy for zoom detection because lgraph is a POS
        const handler = {
            set(target, property, value) {
                if (property === "scale") {
                    debug.log("Zoom detected via scale change:", value);
                    if (self.lastNodePreviewClear) {
                        debug.log("Clearing preview from zoom");
                        self.lastNodePreviewClear();
                        self.lastNodePreviewClear = null;
                        self.lastNode = null;
                        self.lastLoraValue = null;
                    }
                }
                target[property] = value;
                return true;
            }
        };

        // Create proxy for the canvas's ds (drag & scale) object
        actualCanvas.ds = new Proxy(actualCanvas.ds, handler);

        // Make sure events are bound
        actualCanvas.bindEvents();

        // menu handler to cleanup preview
        LGraphCanvas.prototype.showContextMenu = function(values, options, e, prev_menu) {
            if (self.lastNodePreviewClear) {
                self.lastNodePreviewClear();
                self.lastNodePreviewClear = null;
            }
            return origShowMenu.call(this, values, options, e, prev_menu);
        };
        
        // Override widget processing
        LGraphCanvas.prototype.processNodeWidgets = function(node, pos, event, active_widget) {
            const result = origNodeMouse.call(this, node, pos, event, active_widget);
            
            // Early return if feature is disabled
            if (!self.isEnabled()) return result;                
    
            // Only process click events
            if (node && event?.type === "pointerdown") {
                // Early return if it's the same node being clicked
                if (node === self.lastNode && self.lastLoraValue == null) {
                    return result;
                }
    
                // Find any LoRA widget in the node
                const widget = node.widgets?.find(w => {
                    const isLoraName = w.name === "lora_name";
                    const isLoraNumbered = w.name.match(/^lora_\d+$/);
                    const isRgthreeLora = node.type === "Power Lora Loader (rgthree)" && 
                                        w.name === "string" && 
                                        w.value && 
                                        typeof w.value === 'object' && 
                                        'lora' in w.value;
                    
                    return isLoraName || isLoraNumbered || isRgthreeLora;
                });
    
                if (widget) {
                    const currentValue = widget.value;
                    const isSameValue = currentValue === self.lastLoraValue;
    
                    // Only process if value changed
                    if (!isSameValue) {
                        const loraName = self.extractLoraName(widget, node);
                        if (loraName) {
                            // Update tracking values
                            self.lastNode = node;
                            self.lastLoraValue = currentValue;
    
                            if (self.isSidebarOpen()) {
                                self.showLoraInfo(loraName);
                            } else {

                                if (self.menuIsOpening) {
                                    debug.log("Menu is opening, skipping preview");
                                    return result;
                                }

                                // Use the proper LGraphCanvas instance through self
                                const canvas = actualCanvas;

                                const currentZoom = actualCanvas.ds.scale;
                                if (currentZoom < (self.zoomLevel / 100)) {
                                    console.info("Zoom too far out for preview:", self.zoomLevel);
                                    return;
                                }
                                
                                // Get node dimensions to see how big it is
                                const nodeBounds = node.getBounding();
                                const nodeHeight = nodeBounds[3] * canvas.ds.scale; // Height in screen space

                                // Try to get node's screen position
                                function getNodeScreenCoordinates(node, graphCanvas) {
                                    // 1. Get raw data
                                    const nodePos = {
                                        x: node.pos[0],
                                        y: node.pos[1]
                                    };
                                    const canvasData = {
                                        offset: graphCanvas.ds.offset,
                                        scale: graphCanvas.ds.scale,
                                        rect: graphCanvas.canvas.getBoundingClientRect(),
                                        width: graphCanvas.canvas.width
                                    };
                                    
                                    // 2. Calculate base positions
                                    const scaleCompensation = (1 - canvasData.scale) * 0;
                                    const transformedPos = {
                                        x: (nodePos.x + canvasData.offset[0]) * canvasData.scale + scaleCompensation,
                                        y: (nodePos.y + canvasData.offset[1]) * canvasData.scale + scaleCompensation,
                                        //y: (nodePos.y * canvasData.scale) + canvasData.offset[1]
                                    };
                                    
                                    // 3. Calculate screen bounds
                                    const screenPos = {
                                        x: canvasData.rect.left + transformedPos.x,
                                        y: canvasData.rect.top + transformedPos.y
                                    };
                                    
                                    // 4. Calculate distance from center
                                    const canvasCenter = canvasData.width / 2;
                                    const distanceFromCenter = nodePos.x - canvasCenter;
                                    
                                    // 5. Build final bounds
                                    const rawBounds = {
                                        left: screenPos.x,
                                        right: screenPos.x + (nodeBounds[2] * canvasData.scale),
                                        top: screenPos.y,
                                        height: nodeBounds[3] * canvasData.scale
                                    };
                                    
                                    const correctedBounds = {
                                        left: rawBounds.left * canvasData.scale,
                                        right: rawBounds.right * canvasData.scale,
                                        top: rawBounds.top * canvasData.scale,
                                        height: rawBounds.height * canvasData.scale
                                    };
                                
                                    // Debug logs
                                    debug.log("Node bounds:", {
                                        raw: rawBounds,
                                        corrected: correctedBounds,
                                        scale: canvasData.scale
                                    });
                                    debug.log("Distance from center:", {
                                        canvasWidth: canvasData.width,
                                        canvasCenter,
                                        nodePos: nodePos.x,
                                        distance: distanceFromCenter
                                    });
                                    debug.log("Position calculations:", {
                                        rawPos: nodePos.x,
                                        scale: canvasData.scale,
                                        transformed: transformedPos,
                                        withoutScale: nodePos.x + canvasData.offset[0],
                                        scaleFirst: (nodePos.x + canvasData.offset[0]) * canvasData.scale
                                    });
                                
                                    return {
                                        bounds: correctedBounds,
                                        transformedX: screenPos.x,
                                        transformedY: screenPos.y,
                                        distanceFromCenter,
                                        height: rawBounds.height
                                    };
                                }
                                
                                const nodeInfo = getNodeScreenCoordinates(node, canvas);
                                const nodeScreenPos = nodeInfo.bounds;
                                const canvasScale = canvas.ds.scale;

                                // distanceFromCenter = nodeInfo.distanceFromCenter;
                                
                                // Calculate final position with zoom compensation
                                const padding = 3;
                                const scaledPadding = padding //* (1 / canvas.ds.scale)
                                // Fix for weird drift BS
                                const baseMultiplier = 0.001;
                                const zoomCompensation = 1 / canvasScale;
                                const offsetMultiplier = baseMultiplier * zoomCompensation;
                                const centerOffset = nodeInfo.distanceFromCenter * offsetMultiplier;

                                const finalPos = {
                                    x: nodeInfo.transformedX - scaledPadding + centerOffset,
                                    y: nodeInfo.transformedY + (nodeInfo.height / 2)
                                    //y: nodeInfo.transformedY - scaledPadding + centerOffset,
                                    //y: nodeScreenPos.top + (nodeScreenPos.height * .5)
                                };

                                // Final debug logs
                                debug.log("Final position:", {
                                    nodeLeft: nodeScreenPos.left,
                                    originCompensation: centerOffset,
                                    finalLeft: nodeScreenPos.left + centerOffset,
                                    finalPos,
                                    mouseClick: { x: event.x, y: event.y }
                                });
                            
                                if (self.lastNodePreviewClear) {
                                    debug.log("Clearing last node preview.");
                                    self.lastNodePreviewClear();
                                    self.lastNodePreviewClear = null;
                                }
                            
                                // Check if menu exists or appears within a few ms
                                setTimeout(async () => {
                                    const menuExists = document.querySelector('.litecontextmenu');
                                    if (!menuExists) {
                                        // Only show preview if no menu appeared
                                        self.showPreviewOnCanvas(
                                            loraName,
                                            finalPos.x,
                                            finalPos.y,
                                            null,
                                            nodeHeight,
                                            canvasScale
                                        ).then(cleanupFunc => {
                                            debug.log("Preview successfully created for node:", node.id);
                                            self.lastNodePreviewClear = cleanupFunc;
                                        }).catch(error => {
                                            console.error("Failed to create preview for node:", node.id, "Error:", error);
                                        });
                                    }
                                }, 30);  // Small delay to check for menu
                            }
                        }
                    }
                } else {
                    // Reset tracking if not a LoRA node
                    self.lastNode = null;
                    self.lastLoraValue = null;
                    if (self.lastNodePreviewClear) {
                        self.lastNodePreviewClear();
                        self.lastNodePreviewClear = null;
                    }
                }
            } else if (event?.type === "pointerup") {
                // Only reset node tracking on mouse up outside nodes
                if (!node) {
                    self.lastNode = null;
                    self.lastLoraValue = null;
                    if (self.lastNodePreviewClear) {
                        self.lastNodePreviewClear();
                        self.lastNodePreviewClear = null;
                    }
                }
            }
            
            return result;
        };
    }

    setupMenuObserver() {
        if (!this.enabled || !this.showMenu) return;

        debug.log("Setting up menu observer");
        let currentLoraWidget = null;
        let searchTimeout = null;
        let hasShownSearchMessage = false;
        const self = this;
        const actualCanvas = this.app.canvas;
    
        // Store the last clicked widget/node that might spawn a menu
        let lastClickedWidget = null;
        let lastClickedNode = null;

        // Add to your existing node click handler
        const origNodeMouse = LGraphCanvas.prototype.processNodeWidgets;
        LGraphCanvas.prototype.processNodeWidgets = function(node, pos, event, active_widget) {
            const result = origNodeMouse.call(this, node, pos, event, active_widget);
            
            // Store widget info when clicked
            if (node && event?.type === "pointerdown") {
                const widget = node.widgets?.find(w => {
                    const isLoraName = w.name === "lora_name";
                    const isLoraNumbered = w.name.match(/^lora_\d+$/);
                    const isRgthreeLora = node.type === "Power Lora Loader (rgthree)" && 
                                        w.name === "string" && 
                                        w.value && 
                                        typeof w.value === 'object' && 
                                        'lora' in w.value;
                    
                    return isLoraName || isLoraNumbered || isRgthreeLora;
                });

                if (widget) {
                    lastClickedWidget = widget;
                    lastClickedNode = node;
                } else {
                    lastClickedWidget = null;
                    lastClickedNode = null;
                }
            }
            return result;
        };

        // Menu mutation observer
        const menuWatcher = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.classList?.contains('litecontextmenu')) {
                        // Clear any existing preview
                        if (self.lastNodePreviewClear) {
                            debug.log("Menu appeared, clearing preview");
                            self.lastNodePreviewClear();
                            self.lastNodePreviewClear = null;
                            self.lastNode = null;
                            self.lastLoraValue = null;
                        }

                        let cleanup = null;

                        // Check if this menu is from our last clicked LoRA widget
                        if (lastClickedWidget) {
                            debug.log("Menu from LoRA widget:", lastClickedWidget.name);
                            
                            // Your existing filter input handler
                            const filterInput = node.querySelector('.comfy-context-menu-filter');
                            if (filterInput) {
                                filterInput.addEventListener('input', (e) => {
                                    if (searchTimeout) {
                                        clearTimeout(searchTimeout);
                                    }
                                    searchTimeout = setTimeout(() => {
                                        if (cleanup) cleanup();
                                        cleanup = handleMenuItems(node);
                                    }, 50);
                                });
                            }

                            // Initial setup of menu items
                            cleanup = handleMenuItems(node);

                            // Your existing cleanup observer
                            const menuRemovalObserver = new MutationObserver((removeMutations) => {
                                removeMutations.forEach(mutation => {
                                    mutation.removedNodes.forEach(removedNode => {
                                        if (removedNode === node) {
                                            if (cleanup) cleanup();
                                            menuRemovalObserver.disconnect();
                                            if (searchTimeout) {
                                                clearTimeout(searchTimeout);
                                            }
                                            // Clear last clicked tracking
                                            lastClickedWidget = null;
                                            lastClickedNode = null;
                                        }
                                    });
                                });
                            });

                            menuRemovalObserver.observe(node.parentNode, {
                                childList: true
                            });
                        }
                    }
                });
            });
        });
    
        const handleMenuItems = (menuElement) => {
            const menuItems = menuElement.querySelectorAll('.litemenu-entry[data-value]');
            menuItems.forEach(item => {
                let clearPreview = null;
                
                // Simple hover handler
                item._loraHoverHandler = (e) => {
                    if (this.menuDebounceTimer) {
                        clearTimeout(this.menuDebounceTimer);
                    }
                
                    this.menuDebounceTimer = setTimeout(async () => {
                        const loraName = item.dataset.value;
                        if (loraName?.includes('.safetensors')) {
                            const cleanName = loraName.split('\\').pop().replace(/\.[^/.]+$/, '');
                            
                            if (this.isSidebarOpen()) {
                                this.showLoraInfo(cleanName);
                            } else {
                                if (clearPreview) {
                                    clearPreview();
                                    clearPreview = null;
                                }
                                
                                clearPreview = await this.showPreviewOnCanvas(
                                    cleanName,
                                    e.clientX,
                                    e.clientY,
                                    menuElement,
                                    null,
                                    1
                                );
                            }
                        }
                    }, this.menuDebounceDelay);
                };
    
                // Simple mouseout handler
                item._loraOutHandler = () => {
                    if (this.menuDebounceTimer) {
                        clearTimeout(this.menuDebounceTimer);
                        this.menuDebounceTimer = null;
                    }
                };
    
                // Add listeners
                item.addEventListener('mouseover', item._loraHoverHandler);
                item.addEventListener('mouseout', item._loraOutHandler);
            });
    
            // Return cleanup function
            return () => {
                menuItems.forEach(item => {
                    if (item._loraHoverHandler) {
                        item.removeEventListener('mouseover', item._loraHoverHandler);
                        item.removeEventListener('mouseout', item._loraOutHandler);
                        delete item._loraHoverHandler;
                        delete item._loraOutHandler;
                    }
                });
            };
        };
    
        // Start observing
        menuWatcher.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    extractLoraName(widget, node) {
        // Handle different value formats
        const getValue = (value) => {
            if (!value) return '';
            
            // If it's a string, return it directly
            if (typeof value === 'string') return value;
            
            // If it's an object, try different known properties
            if (typeof value === 'object') {
                if (value.content) return value.content;
                if (value.lora) return value.lora;
                if (value.string) return value.string;
                
                // RGThree specific: look for any property that might contain a .safetensors path
                for (const key in value) {
                    if (typeof value[key] === 'string' && value[key].includes('.safetensors')) {
                        return value[key];
                    }
                }
                
                // Last resort, try to stringify
                try {
                    if (typeof value.toString === 'function') {
                        const str = value.toString();
                        if (str !== '[object Object]') return str;
                    }
                } catch (e) {
                    console.debug("Failed to convert LoRA value to string:", e);
                }
            }
            
            return '';
        };

        let loraName = '';
        try {
            if (node.type === "Power Lora Loader (rgthree)" && widget.name === "string") {
                const data = typeof widget.value === 'string' ? JSON.parse(widget.value) : widget.value;
                loraName = getValue(data);
            } else {
                loraName = getValue(widget.value);
            }

            if (loraName) {
                loraName = loraName.split('\\').pop();
                loraName = loraName.replace(/\.[^/.]+$/, '');
            }
        } catch (e) {
            console.error("Error extracting LoRA name:", e);
            return '';
        }

        return loraName;
    }

    async showLoraInfo(loraName) {
        // Double check sidebar is still open
        if (!this.isSidebarOpen()) {
            this.sidebar.showToast(
                "info",
                "LoRA Sidebar Required",
                "Open the LoRA Sidebar to see LoRA information when clicking nodes"
            );
            return;
        }
    
        // Get currently displayed lora name from popup if it exists
        const currentDisplayedName = this.checkCurrentDisplayedLora();
    
        // Get actual lora name from info.json
        try {
            const response = await fetch(`/lora_sidebar/info/${encodeURIComponent(loraName)}`);
            if (response.ok) {
                const data = await response.json();
                if (data.status === "success" && data.info?.name === currentDisplayedName) {
                    return; // Exit if the same lora is already being displayed
                }
            }
        } catch (error) {
            console.error("Failed to fetch LoRA info:", error);
        }
    
        // If we get here, either the names don't match or there was an error, proceed with showing the lora
        const lora = this.sidebar.loraData.find(l => {
            const filename = l.path?.split('\\').pop() || '';
            const cleanName = filename.replace(/\.[^/.]+$/, '');
            return cleanName === loraName;
        });
    
        if (lora) {
            this.sidebar.showLoraInfo(lora, null);
        } else {
            this.sidebar.showToast(
                "warn",
                "LoRA Not Found",
                "Could not find matching LoRA in sidebar data"
            );
        }
    }

    checkCurrentDisplayedLora() {
        // If no popup exists, no need to check further
        if (!this.sidebar.currentPopup) {
            return null;
        }
    
        // Get name from the current popup
        const nameElement = this.sidebar.currentPopup.querySelector('.lora-name');
        if (!nameElement) {
            return null;
        }
        
        return nameElement.textContent.trim();
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            if (this.currentHoverTimer) {
                clearTimeout(this.currentHoverTimer);
                this.currentHoverTimer = null;
            }
            if (this.menuDebounceTimer) {
                clearTimeout(this.menuDebounceTimer);
                this.menuDebounceTimer = null;
            }
            this.lastNode = null;  // Reset last node when disabled
        }
    }

    updateShowTrained(newVal) {
        this.showTrained = newVal;
        debug.log("Updated showTrained:", this.showTrained);
    }

    updateZoomLevel(newVal) {
        this.zoomLevel = newVal;
        debug.log("Updated zoomLevel:", this.zoomLevel);
    }

    updateShowOnMenu(newVal) {
        this.showMenu = newVal;
        debug.log("Updated showMenu:", this.showMenu);
    }

    updateShowOnCanvas(newVal) {
        this.showCanvas = newVal;
        debug.log("Updated showCanvas:", this.showCanvas);
    }

    updateShowSidebar(newVal) {
        this.showSidebar = newVal;
        debug.log("Updated showSidebar:", this.showSidebar);
    }

}

export default LoraSmartInfo;