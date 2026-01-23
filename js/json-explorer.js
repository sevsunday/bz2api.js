/**
 * JSON Explorer Component
 * Interactive JSON tree viewer with search, tooltips, and syntax highlighting
 */

class JsonExplorer {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' 
      ? document.querySelector(container) 
      : container;
    
    this.schema = options.schema || {};
    this.data = null;
    this.rawData = null;
    this.searchTerm = '';
    this.expandedPaths = new Set();
    this.defaultExpandDepth = options.defaultExpandDepth ?? 2;
    this.viewMode = 'parsed'; // 'parsed' or 'raw'
    this.matchCount = 0;
    
    this.init();
  }
  
  init() {
    // Build the component structure
    this.container.innerHTML = `
      <div class="json-explorer">
        <div class="json-explorer-toolbar">
          <select class="view-select" title="Select data view">
            <option value="parsed">Parsed</option>
            <option value="raw">Raw</option>
          </select>
          <div class="json-explorer-search">
            <span class="search-icon">🔍</span>
            <input type="text" placeholder="Search properties..." />
            <button class="clear-btn" title="Clear search">×</button>
          </div>
          <span class="json-explorer-stats"></span>
          <button class="tool-btn expand-all" title="Expand all nodes">⊕ All</button>
          <button class="tool-btn collapse-all" title="Collapse all nodes">⊖ All</button>
          <button class="tool-btn copy-btn" title="Copy JSON to clipboard">Copy</button>
        </div>
        <div class="json-explorer-tree">
          <div class="json-explorer-loading">No data loaded</div>
        </div>
      </div>
    `;
    
    // Cache DOM references
    this.treeContainer = this.container.querySelector('.json-explorer-tree');
    this.searchInput = this.container.querySelector('.json-explorer-search input');
    this.clearBtn = this.container.querySelector('.clear-btn');
    this.statsEl = this.container.querySelector('.json-explorer-stats');
    this.viewSelect = this.container.querySelector('.view-select');
    
    // Bind events
    this.searchInput.addEventListener('input', () => this.handleSearch());
    this.clearBtn.addEventListener('click', () => this.clearSearch());
    this.container.querySelector('.expand-all').addEventListener('click', () => this.expandAll());
    this.container.querySelector('.collapse-all').addEventListener('click', () => this.collapseAll());
    this.container.querySelector('.copy-btn').addEventListener('click', (e) => this.copyJson(e));
    this.viewSelect.addEventListener('change', (e) => this.setViewMode(e.target.value));
    
    // Tooltip handling
    this.tooltip = null;
    this.tooltipTarget = null;
    
    // Use mouseover/mouseout for better event delegation
    this.container.addEventListener('mouseover', (e) => this.handleTooltipHover(e));
    this.container.addEventListener('mouseout', (e) => this.handleTooltipLeave(e));
    
    // Intercept copy events for clean JSON output
    this.treeContainer.addEventListener('copy', (e) => this.handleCopy(e));
  }
  
  setData(parsedData, rawData = null) {
    this.data = parsedData;
    this.rawData = rawData;
    this.render();
  }
  
  setSchema(schema) {
    this.schema = schema;
  }
  
  setViewMode(mode) {
    this.viewMode = mode;
    this.viewSelect.value = mode;
    this.render();
  }
  
  getCurrentData() {
    return this.viewMode === 'raw' ? this.rawData : this.data;
  }
  
  render() {
    const data = this.getCurrentData();
    if (!data) {
      this.treeContainer.innerHTML = '<div class="json-explorer-loading">No data loaded</div>';
      return;
    }
    
    // Initialize default expanded paths
    this.initDefaultExpanded(data, '', 0);
    
    // Render tree
    this.treeContainer.innerHTML = '';
    const rootNode = this.renderNode(data, '');
    this.treeContainer.appendChild(rootNode);
    
    // Apply search if active
    if (this.searchTerm) {
      this.applySearch();
    }
  }
  
  initDefaultExpanded(value, path, depth) {
    if (depth < this.defaultExpandDepth && (typeof value === 'object' && value !== null)) {
      this.expandedPaths.add(path || 'root');
      
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          this.initDefaultExpanded(item, `${path}[${index}]`, depth + 1);
        });
      } else {
        Object.keys(value).forEach(key => {
          const childPath = path ? `${path}.${key}` : key;
          this.initDefaultExpanded(value[key], childPath, depth + 1);
        });
      }
    }
  }
  
  renderNode(value, path, key = null, isArrayItem = false, index = null) {
    const node = document.createElement('div');
    node.className = 'json-node';
    node.dataset.path = path;
    
    const line = document.createElement('div');
    line.className = 'json-node-line';
    
    const isObject = typeof value === 'object' && value !== null;
    const isArray = Array.isArray(value);
    const isExpandable = isObject && (isArray ? value.length > 0 : Object.keys(value).length > 0);
    const pathKey = path || 'root';
    const isExpanded = this.expandedPaths.has(pathKey);
    
    // Toggle button
    const toggle = document.createElement('span');
    toggle.className = `json-node-toggle ${isExpandable ? (isExpanded ? 'expanded' : 'collapsed') : 'empty'}`;
    if (isExpandable) {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleNode(pathKey, toggle, node);
      });
    }
    line.appendChild(toggle);
    
    // Key or index
    if (key !== null) {
      const keySpan = document.createElement('span');
      keySpan.className = isArrayItem ? 'json-index' : 'json-key';
      keySpan.textContent = isArrayItem ? `[${index}]` : key;
      line.appendChild(keySpan);
    }
    
    // Value
    if (isObject) {
      const summary = document.createElement('span');
      summary.className = 'json-summary';
      
      if (isArray) {
        summary.innerHTML = `<span class="type">Array</span><span class="count">(${value.length})</span>`;
      } else {
        const keys = Object.keys(value);
        summary.innerHTML = `<span class="type">Object</span><span class="count">{${keys.length}}</span>`;
      }
      line.appendChild(summary);
    } else {
      const valueSpan = document.createElement('span');
      valueSpan.className = 'json-value ' + this.getValueType(value);
      valueSpan.textContent = this.formatValue(value);
      line.appendChild(valueSpan);
    }
    
    // Tooltip icon
    const tooltipText = this.getTooltip(path);
    if (tooltipText && this.viewMode === 'parsed') {
      const tooltipIcon = document.createElement('span');
      tooltipIcon.className = 'json-tooltip-icon';
      tooltipIcon.textContent = 'ℹ️';
      tooltipIcon.dataset.tooltip = tooltipText;
      tooltipIcon.dataset.tooltipPath = path;
      line.appendChild(tooltipIcon);
    }
    
    node.appendChild(line);
    
    // Children
    if (isObject) {
      const children = document.createElement('div');
      children.className = `json-children${isExpanded ? '' : ' hidden'}`;
      
      if (isArray) {
        value.forEach((item, i) => {
          const childPath = `${path}[${i}]`;
          children.appendChild(this.renderNode(item, childPath, null, true, i));
        });
      } else {
        Object.entries(value).forEach(([k, v]) => {
          const childPath = path ? `${path}.${k}` : k;
          children.appendChild(this.renderNode(v, childPath, k, false));
        });
      }
      
      node.appendChild(children);
    }
    
    return node;
  }
  
  getValueType(value) {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') return 'string';
    return 'unknown';
  }
  
  formatValue(value) {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return value.toString();
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'string') {
      // Truncate very long strings
      if (value.length > 100) {
        return value.substring(0, 100) + '...';
      }
      return value;
    }
    return String(value);
  }
  
  toggleNode(pathKey, toggleEl, nodeEl) {
    const children = nodeEl.querySelector(':scope > .json-children');
    if (!children) return;
    
    const isExpanded = this.expandedPaths.has(pathKey);
    
    if (isExpanded) {
      this.expandedPaths.delete(pathKey);
      toggleEl.className = 'json-node-toggle collapsed';
      children.classList.add('hidden');
    } else {
      this.expandedPaths.add(pathKey);
      toggleEl.className = 'json-node-toggle expanded';
      children.classList.remove('hidden');
    }
  }
  
  expandAll() {
    this.container.querySelectorAll('.json-node-toggle.collapsed').forEach(toggle => {
      const node = toggle.closest('.json-node');
      const path = node.dataset.path || 'root';
      this.expandedPaths.add(path);
      toggle.className = 'json-node-toggle expanded';
      const children = node.querySelector(':scope > .json-children');
      if (children) children.classList.remove('hidden');
    });
  }
  
  collapseAll() {
    this.expandedPaths.clear();
    // Keep root expanded
    this.expandedPaths.add('root');
    
    this.container.querySelectorAll('.json-node-toggle.expanded').forEach(toggle => {
      const node = toggle.closest('.json-node');
      const path = node.dataset.path;
      
      if (path === '' || path === 'root') {
        // Keep root expanded
        return;
      }
      
      toggle.className = 'json-node-toggle collapsed';
      const children = node.querySelector(':scope > .json-children');
      if (children) children.classList.add('hidden');
    });
  }
  
  handleSearch() {
    this.searchTerm = this.searchInput.value.trim().toLowerCase();
    this.clearBtn.classList.toggle('visible', this.searchTerm.length > 0);
    this.applySearch();
  }
  
  clearSearch() {
    this.searchInput.value = '';
    this.searchTerm = '';
    this.clearBtn.classList.remove('visible');
    this.applySearch();
  }
  
  applySearch() {
    this.matchCount = 0;
    
    // Remove previous search classes and highlights
    this.container.querySelectorAll('.search-hidden, .search-match, .search-ancestor').forEach(el => {
      el.classList.remove('search-hidden', 'search-match', 'search-ancestor');
    });
    this.container.querySelectorAll('.json-highlight').forEach(el => {
      el.outerHTML = el.textContent;
    });
    
    if (!this.searchTerm) {
      this.statsEl.textContent = '';
      return;
    }
    
    // Find all matches
    const matches = new Set();
    const ancestors = new Set();
    
    this.container.querySelectorAll('.json-node').forEach(node => {
      const path = node.dataset.path;
      const line = node.querySelector(':scope > .json-node-line');
      const keyEl = line.querySelector('.json-key, .json-index');
      const valueEl = line.querySelector('.json-value');
      
      let isMatch = false;
      
      // Check key/path
      if (keyEl && keyEl.textContent.toLowerCase().includes(this.searchTerm)) {
        isMatch = true;
        this.highlightText(keyEl, this.searchTerm);
      }
      
      // Check value
      if (valueEl && valueEl.textContent.toLowerCase().includes(this.searchTerm)) {
        isMatch = true;
        this.highlightText(valueEl, this.searchTerm);
      }
      
      // Check path
      if (path && path.toLowerCase().includes(this.searchTerm)) {
        isMatch = true;
      }
      
      if (isMatch) {
        matches.add(path);
        this.matchCount++;
        
        // Mark ancestors
        let parentPath = path;
        while (parentPath) {
          const lastDot = Math.max(parentPath.lastIndexOf('.'), parentPath.lastIndexOf('['));
          if (lastDot > 0) {
            parentPath = parentPath.substring(0, lastDot);
            ancestors.add(parentPath);
          } else {
            ancestors.add('');
            break;
          }
        }
      }
    });
    
    // Apply visibility
    this.container.querySelectorAll('.json-node').forEach(node => {
      const path = node.dataset.path;
      
      if (matches.has(path)) {
        node.classList.add('search-match');
        // Ensure ancestors are expanded
        let parent = node.parentElement.closest('.json-node');
        while (parent) {
          const parentPath = parent.dataset.path || 'root';
          this.expandedPaths.add(parentPath);
          const toggle = parent.querySelector(':scope > .json-node-line > .json-node-toggle');
          const children = parent.querySelector(':scope > .json-children');
          if (toggle) toggle.className = 'json-node-toggle expanded';
          if (children) children.classList.remove('hidden');
          parent = parent.parentElement.closest('.json-node');
        }
      } else if (ancestors.has(path) || path === '') {
        node.classList.add('search-ancestor');
      } else {
        node.classList.add('search-hidden');
      }
    });
    
    // Update stats
    this.statsEl.innerHTML = `<span class="match-count">${this.matchCount}</span> match${this.matchCount !== 1 ? 'es' : ''}`;
  }
  
  highlightText(element, term) {
    const text = element.textContent;
    const lowerText = text.toLowerCase();
    const index = lowerText.indexOf(term);
    
    if (index >= 0) {
      const before = text.substring(0, index);
      const match = text.substring(index, index + term.length);
      const after = text.substring(index + term.length);
      
      element.innerHTML = this.escapeHtml(before) + 
        `<span class="json-highlight">${this.escapeHtml(match)}</span>` + 
        this.escapeHtml(after);
    }
  }
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  getTooltip(path) {
    if (!path || !this.schema) return null;
    
    // Helper to convert bracket notation to dot wildcard notation
    // e.g., "players[0].name" -> "players.*.name"
    const toWildcardPath = (p) => p.replace(/\[(\d+)\]/g, '.*');
    
    // Direct match
    if (this.schema[path]) {
      return this.schema[path];
    }
    
    // Build list of patterns to try
    const patterns = new Set();
    patterns.add(path);
    
    // Convert bracket indices to wildcard: players[0] -> players.*
    const wildcardPath = toWildcardPath(path);
    patterns.add(wildcardPath);
    
    // For single-session view, also try prefixing with "sessions.*"
    // This handles paths like "name" -> "sessions.*.name"
    patterns.add(`sessions.*.${path}`);
    patterns.add(`sessions.*.${wildcardPath}`);
    
    // For nested objects like "nat.id" -> "sessions.*.nat.id"
    // Already handled above
    
    // For arrays inside single session like "players[0]" -> "sessions.*.players.*"
    // Already handled above with wildcardPath
    
    for (const pattern of patterns) {
      if (this.schema[pattern]) {
        return this.schema[pattern];
      }
    }
    
    return null;
  }
  
  handleTooltipHover(e) {
    const icon = e.target.closest('.json-tooltip-icon');
    if (!icon || icon === this.tooltipTarget) return;
    
    // Hide any existing tooltip first
    this.destroyTooltip();
    
    const text = icon.dataset.tooltip;
    const path = icon.dataset.tooltipPath;
    if (!text) return;
    
    this.tooltipTarget = icon;
    
    // Create tooltip
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'json-tooltip';
    this.tooltip.innerHTML = `
      <div class="tooltip-path">${this.escapeHtml(path)}</div>
      <div class="tooltip-desc">${this.escapeHtml(text)}</div>
    `;
    
    document.body.appendChild(this.tooltip);
    
    // Position tooltip
    const iconRect = icon.getBoundingClientRect();
    const tooltipRect = this.tooltip.getBoundingClientRect();
    
    let left = iconRect.right + 8;
    let top = iconRect.top - 4;
    
    // Keep within viewport
    if (left + tooltipRect.width > window.innerWidth - 16) {
      left = iconRect.left - tooltipRect.width - 8;
    }
    if (top + tooltipRect.height > window.innerHeight - 16) {
      top = window.innerHeight - tooltipRect.height - 16;
    }
    if (top < 8) top = 8;
    
    this.tooltip.style.left = left + 'px';
    this.tooltip.style.top = top + 'px';
  }
  
  handleTooltipLeave(e) {
    // Check if we're leaving the tooltip icon
    const icon = e.target.closest('.json-tooltip-icon');
    if (icon && icon === this.tooltipTarget) {
      // Check if we're moving to a child element (shouldn't happen, but safety check)
      const relatedTarget = e.relatedTarget;
      if (relatedTarget && icon.contains(relatedTarget)) {
        return;
      }
      this.destroyTooltip();
    }
  }
  
  destroyTooltip() {
    if (this.tooltip) {
      this.tooltip.remove();
      this.tooltip = null;
    }
    this.tooltipTarget = null;
  }
  
  copyJson(e) {
    const data = this.getCurrentData();
    if (!data) return;
    
    const btn = e.target;
    const json = JSON.stringify(data, null, 2);
    
    navigator.clipboard.writeText(json).then(() => {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copy';
        btn.classList.remove('copied');
      }, 1500);
    }).catch(err => {
      console.error('Failed to copy:', err);
      btn.textContent = 'Error';
      setTimeout(() => btn.textContent = 'Copy', 1500);
    });
  }
  
  /**
   * Handle copy event for manual selection - outputs clean JSON
   */
  handleCopy(e) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    
    const data = this.getCurrentData();
    if (!data) return;
    
    // Get all selected nodes
    const selectedPaths = this.getSelectedPaths(selection);
    if (selectedPaths.length === 0) return;
    
    // Build clean JSON from selected paths
    const result = this.buildJsonFromPaths(data, selectedPaths);
    if (result === null || result === undefined) return;
    
    // Format the result
    let jsonOutput;
    if (typeof result === 'object') {
      jsonOutput = JSON.stringify(result, null, 2);
    } else {
      // Single primitive value
      jsonOutput = JSON.stringify(result);
    }
    
    // Replace clipboard contents with clean JSON
    e.preventDefault();
    e.clipboardData.setData('text/plain', jsonOutput);
  }
  
  /**
   * Get paths of all nodes that intersect with the selection
   */
  getSelectedPaths(selection) {
    const paths = [];
    const range = selection.getRangeAt(0);
    
    // Get all json-node elements
    const allNodes = this.treeContainer.querySelectorAll('.json-node');
    
    for (const node of allNodes) {
      // Check if this node intersects with selection
      if (this.nodeIntersectsRange(node, range)) {
        const path = node.dataset.path;
        if (path !== undefined) {
          // Only add if not a child of already-added path (avoid duplicates)
          const isChild = paths.some(p => 
            path.startsWith(p + '.') || path.startsWith(p + '[')
          );
          if (!isChild) {
            // Remove any children paths if we're adding a parent
            const filteredPaths = paths.filter(p => 
              !p.startsWith(path + '.') && !p.startsWith(path + '[')
            );
            filteredPaths.push(path);
            paths.length = 0;
            paths.push(...filteredPaths);
          }
        }
      }
    }
    
    return paths;
  }
  
  /**
   * Check if a DOM node intersects with a Range
   */
  nodeIntersectsRange(node, range) {
    const nodeRange = document.createRange();
    nodeRange.selectNode(node);
    
    // Check if ranges overlap
    const startToStart = range.compareBoundaryPoints(Range.START_TO_START, nodeRange);
    const startToEnd = range.compareBoundaryPoints(Range.START_TO_END, nodeRange);
    const endToStart = range.compareBoundaryPoints(Range.END_TO_START, nodeRange);
    const endToEnd = range.compareBoundaryPoints(Range.END_TO_END, nodeRange);
    
    // They overlap if selection start is before node end AND selection end is after node start
    return startToEnd >= 0 && endToStart <= 0;
  }
  
  /**
   * Extract data from paths and build a JSON structure
   */
  buildJsonFromPaths(data, paths) {
    if (paths.length === 0) return null;
    
    // If only one path, return just that value
    if (paths.length === 1) {
      const path = paths[0];
      if (path === '' || path === 'root') {
        return data;
      }
      return this.getValueAtPath(data, path);
    }
    
    // Multiple paths - find common ancestor and build partial object
    const commonAncestor = this.findCommonAncestor(paths);
    
    if (commonAncestor === '' || commonAncestor === 'root') {
      // Build object with selected top-level keys
      const result = {};
      for (const path of paths) {
        const key = path.split('.')[0].split('[')[0];
        result[key] = this.getValueAtPath(data, path);
      }
      return result;
    }
    
    // Get the ancestor value and filter to only selected children
    const ancestorValue = this.getValueAtPath(data, commonAncestor);
    if (typeof ancestorValue !== 'object' || ancestorValue === null) {
      return ancestorValue;
    }
    
    // Build a partial copy with only selected paths
    if (Array.isArray(ancestorValue)) {
      const result = [];
      for (const path of paths) {
        const relativePath = path.substring(commonAncestor.length);
        const match = relativePath.match(/^\[(\d+)\]/);
        if (match) {
          const index = parseInt(match[1]);
          result.push(ancestorValue[index]);
        }
      }
      return result;
    } else {
      const result = {};
      for (const path of paths) {
        const relativePath = path.substring(commonAncestor.length + 1); // +1 for the dot
        const key = relativePath.split('.')[0].split('[')[0];
        if (key && ancestorValue.hasOwnProperty(key)) {
          result[key] = ancestorValue[key];
        }
      }
      return result;
    }
  }
  
  /**
   * Get value at a path like "sessions[0].name" or "players.0.team"
   */
  getValueAtPath(data, path) {
    if (!path || path === '' || path === 'root') return data;
    
    // Parse path into segments
    const segments = [];
    let current = '';
    let i = 0;
    
    while (i < path.length) {
      if (path[i] === '.') {
        if (current) segments.push(current);
        current = '';
        i++;
      } else if (path[i] === '[') {
        if (current) segments.push(current);
        current = '';
        i++;
        // Read until ]
        while (i < path.length && path[i] !== ']') {
          current += path[i];
          i++;
        }
        segments.push(parseInt(current));
        current = '';
        i++; // skip ]
      } else {
        current += path[i];
        i++;
      }
    }
    if (current) segments.push(current);
    
    // Navigate to value
    let value = data;
    for (const segment of segments) {
      if (value === null || value === undefined) return undefined;
      value = value[segment];
    }
    
    return value;
  }
  
  /**
   * Find the common ancestor path of multiple paths
   */
  findCommonAncestor(paths) {
    if (paths.length === 0) return '';
    if (paths.length === 1) return paths[0];
    
    // Split all paths into segments
    const splitPaths = paths.map(p => {
      const segments = [];
      let current = '';
      for (let i = 0; i < p.length; i++) {
        if (p[i] === '.' || p[i] === '[') {
          if (current) segments.push(current);
          current = '';
          if (p[i] === '[') {
            i++;
            while (i < p.length && p[i] !== ']') {
              current += p[i];
              i++;
            }
            segments.push('[' + current + ']');
            current = '';
          }
        } else {
          current += p[i];
        }
      }
      if (current) segments.push(current);
      return segments;
    });
    
    // Find common prefix
    const common = [];
    const minLen = Math.min(...splitPaths.map(p => p.length));
    
    for (let i = 0; i < minLen; i++) {
      const segment = splitPaths[0][i];
      if (splitPaths.every(p => p[i] === segment)) {
        common.push(segment);
      } else {
        break;
      }
    }
    
    // Reconstruct path
    return common.map((s, i) => {
      if (s.startsWith('[')) return s;
      return (i > 0 ? '.' : '') + s;
    }).join('');
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = JsonExplorer;
}
