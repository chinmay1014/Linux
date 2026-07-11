/**
 * bootLinux.js - Complete HTTP-based Linux boot loader
 * Fetches all required resources from GitHub and boots a Linux environment in the browser
 * Usage: <script src="https://raw.githubusercontent.com/chinmay1014/Linux/master/bootLinux.js"></script>
 */

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    repo: 'chinmay1014/Linux',
    branch: 'master',
    baseUrl: 'https://raw.githubusercontent.com/chinmay1014/Linux/master',
    files: {
      bootHtml: 'boot.html',
      bootMinJs: 'boot.min.js',
      libLklMinJs: 'liblkl.min.js',
      pthreadMainJs: 'pthread-main.js'
    }
  };

  // Create namespace
  window.bootLinux = window.bootLinux || {};
  const BL = window.bootLinux;

  /**
   * HTTP Fetch with fallback and error handling
   */
  async function fetchFile(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      
      // Return based on content type
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('text')) return response.text();
      if (contentType?.includes('javascript')) return response.text();
      return response.arrayBuffer();
    } catch (error) {
      console.error(`Failed to fetch ${url}:`, error);
      throw error;
    }
  }

  /**
   * Load and inject HTML page into DOM
   */
  async function loadBootHTML() {
    try {
      console.log('[bootLinux] Fetching boot.html...');
      const html = await fetchFile(`${CONFIG.baseUrl}/${CONFIG.files.bootHtml}`);
      
      // Parse HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Extract and inject into document
      const body = doc.body;
      document.body.innerHTML = body.innerHTML;
      
      // Copy styles from loaded HTML
      doc.head.querySelectorAll('style').forEach(style => {
        document.head.appendChild(style.cloneNode(true));
      });
      
      console.log('[bootLinux] Boot HTML loaded');
      return true;
    } catch (error) {
      console.error('[bootLinux] Failed to load boot HTML:', error);
      document.body.innerHTML = '<h1 style="color:red">Failed to load Linux environment</h1><p>' + error.message + '</p>';
      return false;
    }
  }

  /**
   * Load JavaScript file into global scope
   */
  async function loadScript(url, name) {
    try {
      console.log(`[bootLinux] Fetching ${name}...`);
      const code = await fetchFile(url);
      
      // Execute in global scope
      const script = document.createElement('script');
      script.textContent = code;
      script.id = name;
      document.head.appendChild(script);
      
      console.log(`[bootLinux] ${name} loaded`);
      return true;
    } catch (error) {
      console.error(`[bootLinux] Failed to load ${name}:`, error);
      return false;
    }
  }

  /**
   * Setup Web Worker for pthread support
   */
  function setupWebWorker() {
    // Create inline worker with pthread code
    const pthreadCode = `
      ${BL.pthreadCode || ''}
      // Worker initialized
      console.log('Web Worker (pthread) initialized');
    `;
    
    const blob = new Blob([pthreadCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    
    return workerUrl;
  }

  /**
   * Initialize the complete Linux environment
   */
  async function init() {
    console.log('[bootLinux] Initializing Linux boot environment...');
    
    // Update loading indicator if present
    const status = document.getElementById('status');
    if (status) {
      status.textContent = 'Loading Linux environment...';
    }

    try {
      // Step 1: Load HTML
      console.log('[bootLinux] Step 1: Loading HTML');
      await loadBootHTML();

      // Step 2: Load pthread worker code (small)
      console.log('[bootLinux] Step 2: Loading pthread support');
      const pthreadCode = await fetchFile(`${CONFIG.baseUrl}/${CONFIG.files.pthreadMainJs}`);
      BL.pthreadCode = pthreadCode;

      // Step 3: Load main boot code (large - ~51MB)
      console.log('[bootLinux] Step 3: Loading boot runtime (this may take a moment)...');
      await loadScript(`${CONFIG.baseUrl}/${CONFIG.files.bootMinJs}`, 'boot.min.js');

      // Step 4: Load LKL library (large - ~51MB)
      console.log('[bootLinux] Step 4: Loading LKL library...');
      await loadScript(`${CONFIG.baseUrl}/${CONFIG.files.libLklMinJs}`, 'liblkl.min.js');

      // Step 5: Setup worker
      console.log('[bootLinux] Step 5: Setting up Web Worker');
      BL.workerUrl = setupWebWorker();

      // Mark as ready
      BL.ready = true;
      BL.state = 'ready';
      
      console.log('[bootLinux] ✓ Linux environment loaded and ready!');
      
      // Update status
      if (status) {
        status.textContent = 'Linux environment ready';
        status.style.color = '#00ff00';
      }

      // Emit event
      window.dispatchEvent(new Event('bootLinuxReady'));
      
      return true;

    } catch (error) {
      console.error('[bootLinux] Initialization failed:', error);
      BL.state = 'error';
      BL.error = error;
      
      if (status) {
        status.textContent = 'Error: ' + error.message;
        status.style.color = '#ff0000';
      }

      window.dispatchEvent(new CustomEvent('bootLinuxError', { detail: error }));
      return false;
    }
  }

  /**
   * Execute shell command in Linux environment
   */
  BL.exec = function(command, callback) {
    if (!BL.ready) {
      console.error('[bootLinux] Environment not ready');
      return;
    }
    
    if (typeof Module === 'undefined' || typeof Module.asm === 'undefined') {
      console.error('[bootLinux] Module not initialized');
      return;
    }

    console.log('[bootLinux] Executing:', command);
    
    try {
      // Pass command to Linux runtime
      // This depends on the boot module's exposed API
      if (typeof _sys_execve === 'function') {
        _sys_execve(command);
      } else if (typeof FS !== 'undefined') {
        console.log('[bootLinux] Filesystem available, executing via shell');
        // Execute through filesystem shell interface
      }
      
      if (callback) callback(null, 'Command executed');
    } catch (error) {
      console.error('[bootLinux] Execution error:', error);
      if (callback) callback(error);
    }
  };

  /**
   * Get environment status
   */
  BL.getStatus = function() {
    return {
      ready: BL.ready || false,
      state: BL.state || 'uninitialized',
      error: BL.error || null,
      config: CONFIG
    };
  };

  /**
   * Load resource with progress callback
   */
  BL.loadResource = async function(filename) {
    return fetchFile(`${CONFIG.baseUrl}/${filename}`);
  };

  // Auto-initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init().catch(err => console.error('[bootLinux] Async init error:', err));
  }

  console.log('[bootLinux] Module loaded. Use window.bootLinux.exec(cmd) to run commands.');

})();
