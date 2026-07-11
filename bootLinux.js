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
    // Using releases or direct CDN links for large files to avoid LFS issues
    cdnUrl: 'https://cdn.jsdelivr.net/gh/chinmay1014/Linux@master',
    files: {
      bootHtml: 'boot.html',
      bootMinJs: 'boot.min.js',
      libLklMinJs: 'liblkl.min.js',
      pthreadMainJs: 'pthread-main.js'
    },
    fetchTimeout: 120000 // 2 minutes for large files
  };

  // State management
  const STATE = {
    ready: false,
    loading: false,
    error: null,
    pthreadCode: null,
    workerUrl: null,
    modules: {}
  };

  // Create namespace
  window.bootLinux = window.bootLinux || {};
  const BL = window.bootLinux;

  /**
   * HTTP Fetch with timeout and proper error handling
   */
  async function fetchFile(url, options = {}) {
    const timeout = options.timeout || CONFIG.fetchTimeout;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      console.log(`[bootLinux] Fetching: ${url}`);
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': '*/*'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
      }

      // Check for Git LFS pointer
      const text = await response.text();
      if (text.startsWith('version https://git-lfs.github.com/spec/v1')) {
        throw new Error(`File is Git LFS pointer (not downloaded). Use CDN or direct link instead.`);
      }

      return text;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Fetch timeout (${timeout}ms) for ${url}`);
      }
      console.error(`[bootLinux] Fetch failed:`, error.message);
      throw error;
    }
  }

  /**
   * Load and inject HTML page into DOM
   */
  async function loadBootHTML() {
    try {
      console.log('[bootLinux] Step 1: Fetching boot.html...');
      const html = await fetchFile(`${CONFIG.baseUrl}/${CONFIG.files.bootHtml}`);
      
      // Create container if needed
      if (!document.body) {
        document.body = document.createElement('body');
      }

      // Parse HTML
      const parser = new DOMParser();
      const tempDoc = parser.parseFromString(html, 'text/html');

      // Clear existing content but preserve structure
      document.documentElement.lang = tempDoc.documentElement.lang;
      
      // Merge head
      Array.from(tempDoc.head.children).forEach(child => {
        if (child.tagName === 'STYLE') {
          document.head.appendChild(child.cloneNode(true));
        } else if (child.tagName === 'META') {
          document.head.appendChild(child.cloneNode(true));
        } else if (child.tagName === 'TITLE') {
          document.title = child.textContent;
        }
      });

      // Merge body content (preserve canvas and UI elements)
      document.body.innerHTML = tempDoc.body.innerHTML;

      console.log('[bootLinux] ✓ Boot HTML loaded');
      return true;
    } catch (error) {
      console.error('[bootLinux] Failed to load boot HTML:', error);
      throw error;
    }
  }

  /**
   * Load JavaScript file with proper execution handling
   */
  async function loadScript(url, name, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        console.log(`[bootLinux] Step: Loading ${name}...`);

        const script = document.createElement('script');
        script.id = `bootLinux-${name}`;
        script.type = 'text/javascript';

        // Set a timeout for script loading
        const timeout = setTimeout(() => {
          reject(new Error(`Script load timeout: ${name}`));
        }, CONFIG.fetchTimeout);

        script.onload = () => {
          clearTimeout(timeout);
          console.log(`[bootLinux] ✓ ${name} loaded`);
          resolve(true);
        };

        script.onerror = () => {
          clearTimeout(timeout);
          reject(new Error(`Failed to load script: ${name}`));
        };

        // Fetch and inject
        fetchFile(url, options)
          .then(code => {
            script.textContent = code;
            document.head.appendChild(script);
          })
          .catch(error => {
            clearTimeout(timeout);
            reject(error);
          });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Setup Web Worker for pthread support
   */
  function setupWebWorker() {
    try {
      if (!STATE.pthreadCode) {
        console.warn('[bootLinux] No pthread code loaded, worker disabled');
        return null;
      }

      const blob = new Blob([STATE.pthreadCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      
      console.log('[bootLinux] ✓ Web Worker URL created');
      return workerUrl;
    } catch (error) {
      console.warn('[bootLinux] Failed to setup Web Worker:', error);
      return null;
    }
  }

  /**
   * Wait for Module to be available
   */
  async function waitForModule(timeout = 30000) {
    const start = Date.now();
    while (typeof Module === 'undefined' || typeof Module.asm === 'undefined') {
      if (Date.now() - start > timeout) {
        throw new Error('Module initialization timeout');
      }
      await new Promise(r => setTimeout(r, 100));
    }
    return Module;
  }

  /**
   * Initialize the complete Linux environment
   */
  async function init() {
    if (STATE.loading) {
      console.warn('[bootLinux] Already initializing');
      return;
    }

    STATE.loading = true;
    console.log('[bootLinux] Starting initialization...\n');

    const progressLog = (msg) => {
      console.log(`[bootLinux] ${msg}`);
      const status = document.getElementById('status');
      if (status) status.textContent = msg;
    };

    try {
      // Step 1: Load HTML
      progressLog('Loading HTML interface...');
      await loadBootHTML();

      // Step 2: Load pthread worker code (small file, from baseUrl)
      progressLog('Loading pthread support...');
      try {
        STATE.pthreadCode = await fetchFile(`${CONFIG.baseUrl}/${CONFIG.files.pthreadMainJs}`);
      } catch (e) {
        console.warn('[bootLinux] pthread load failed, continuing without it:', e.message);
      }

      // Step 3: Load main boot code (large ~51MB, try multiple sources)
      progressLog('Loading boot runtime (51MB, this may take 30-60 seconds)...');
      let bootLoaded = false;
      
      const bootUrls = [
        `${CONFIG.cdnUrl}/${CONFIG.files.bootMinJs}`,
        `${CONFIG.baseUrl}/${CONFIG.files.bootMinJs}`
      ];

      for (const bootUrl of bootUrls) {
        try {
          await loadScript(bootUrl, 'boot.min.js', { timeout: 120000 });
          bootLoaded = true;
          break;
        } catch (error) {
          console.warn(`[bootLinux] Failed from ${bootUrl.split('/')[2]}:`, error.message);
          continue;
        }
      }

      if (!bootLoaded) {
        throw new Error('Could not load boot.min.js from any source');
      }

      // Step 4: Load LKL library (large ~51MB)
      progressLog('Loading LKL library (51MB, this may take 30-60 seconds)...');
      let lklLoaded = false;

      const lklUrls = [
        `${CONFIG.cdnUrl}/${CONFIG.files.libLklMinJs}`,
        `${CONFIG.baseUrl}/${CONFIG.files.libLklMinJs}`
      ];

      for (const lklUrl of lklUrls) {
        try {
          await loadScript(lklUrl, 'liblkl.min.js', { timeout: 120000 });
          lklLoaded = true;
          break;
        } catch (error) {
          console.warn(`[bootLinux] Failed from ${lklUrl.split('/')[2]}:`, error.message);
          continue;
        }
      }

      if (!lklLoaded) {
        throw new Error('Could not load liblkl.min.js from any source');
      }

      // Step 5: Wait for Module to initialize
      progressLog('Waiting for Emscripten Module to initialize...');
      await waitForModule();

      // Step 6: Setup worker
      progressLog('Setting up Web Worker...');
      STATE.workerUrl = setupWebWorker();

      // Mark as ready
      STATE.ready = true;
      STATE.error = null;
      
      progressLog('✅ Linux environment is ready!');
      console.log('[bootLinux] ✓ All systems initialized\n');
      
      // Emit event
      window.dispatchEvent(new Event('bootLinuxReady'));
      
      return true;

    } catch (error) {
      STATE.loading = false;
      STATE.error = error;
      STATE.ready = false;

      console.error('[bootLinux] ✗ Initialization failed:', error);
      console.error('Stack:', error.stack);

      const status = document.getElementById('status');
      if (status) {
        status.textContent = '❌ Error: ' + error.message;
        status.style.color = '#ff0000';
      }

      window.dispatchEvent(new CustomEvent('bootLinuxError', { detail: error }));
      return false;
    } finally {
      STATE.loading = false;
    }
  }

  /**
   * Execute shell command in Linux environment
   */
  BL.exec = function(command, callback) {
    callback = callback || (() => {});

    if (!STATE.ready) {
      const err = new Error('Environment not ready yet');
      console.error('[bootLinux]', err.message);
      callback(err);
      return;
    }

    if (typeof Module === 'undefined') {
      const err = new Error('Module not available');
      console.error('[bootLinux]', err.message);
      callback(err);
      return;
    }

    console.log('[bootLinux] Executing:', command);

    try {
      // Emscripten runtime function calls
      if (typeof ccall === 'function' && typeof cwrap === 'function') {
        // Try to call main with argv
        const result = Module.callMain(['-c', command]);
        console.log('[bootLinux] Result:', result);
        callback(null, result);
      } else if (typeof Module.asm !== 'undefined') {
        console.log('[bootLinux] ASM ready, command queued');
        callback(null, 'Command queued');
      } else {
        throw new Error('Runtime not properly initialized');
      }
    } catch (error) {
      console.error('[bootLinux] Execution error:', error);
      callback(error);
    }
  };

  /**
   * Get environment status
   */
  BL.getStatus = function() {
    return {
      ready: STATE.ready,
      loading: STATE.loading,
      error: STATE.error?.message || null,
      hasModule: typeof Module !== 'undefined',
      hasFilesystem: typeof FS !== 'undefined',
      config: CONFIG
    };
  };

  /**
   * Load and return resource
   */
  BL.loadResource = async function(filename) {
    try {
      return await fetchFile(`${CONFIG.baseUrl}/${filename}`);
    } catch (error) {
      console.error('[bootLinux] Resource load failed:', error);
      throw error;
    }
  };

  /**
   * Expose state and utilities
   */
  BL.state = STATE;
  BL._config = CONFIG;

  // Auto-initialize
  console.log('[bootLinux] Module loaded. Initialization starting...\n');
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init().catch(err => console.error('[bootLinux] Init error:', err));
    });
  } else {
    init().catch(err => console.error('[bootLinux] Init error:', err));
  }

})();
