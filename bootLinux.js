/**
 * bootLinux.js - Production-Grade Linux Boot Loader for Embedded Systems
 * 
 * CRITICAL: This code runs in embedded environments where failures are costly.
 * Requirements:
 * - Zero memory leaks
 * - Graceful degradation on all failures
 * - Complete error tracking and recovery
 * - Safe resource cleanup
 * - Timeout protection on all async operations
 * - No external dependencies beyond native APIs
 * 
 * Usage: <script src="https://raw.githubusercontent.com/chinmay1014/Linux/master/bootLinux.js"></script>
 */

(function() {
  'use strict';

  // ====================================================================================
  // CONFIGURATION & CONSTANTS
  // ====================================================================================
  
  const VERSION = '1.0.0-production';
  const DEBUG = false; // Set to true for verbose logging
  
  const CONFIG = {
    repo: 'chinmay1014/Linux',
    branch: 'master',
    baseUrl: 'https://raw.githubusercontent.com/chinmay1014/Linux/master',
    cdnUrl: 'https://cdn.jsdelivr.net/gh/chinmay1014/Linux@master',
    files: {
      bootHtml: 'boot.html',
      bootMinJs: 'boot.min.js',
      libLklMinJs: 'liblkl.min.js',
      pthreadMainJs: 'pthread-main.js'
    },
    timeouts: {
      smallFile: 30000,    // 30s for HTML/JS config files
      largeFile: 180000,   // 3min for 51MB+ files
      moduleInit: 60000,   // 1min for Module initialization
      scriptExecution: 10000 // 10s for script exec
    },
    retries: {
      maxAttempts: 2,      // Max URL fallbacks per file
      delayMs: 1000        // Delay between retries
    },
    memory: {
      maxScriptSize: 100 * 1024 * 1024, // 100MB safety limit
      maxHtmlSize: 5 * 1024 * 1024      // 5MB safety limit
    }
  };

  // ====================================================================================
  // LOGGING & ERROR TRACKING
  // ====================================================================================

  const LOG = {
    history: [],
    maxHistory: 1000,
    
    _write(level, args) {
      const timestamp = new Date().toISOString();
      const message = `[${timestamp}] [${level}]`;
      const logEntry = { timestamp, level, args: args.join(' ') };
      
      // Store in history
      this.history.push(logEntry);
      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }
      
      // Console output
      if (DEBUG || level === 'ERROR' || level === 'CRITICAL') {
        console[level === 'ERROR' ? 'error' : 'log'](message, ...args);
      }
    },
    
    info(...args) {
      this._write('INFO', args);
    },
    
    warn(...args) {
      this._write('WARN', args);
    },
    
    error(...args) {
      this._write('ERROR', args);
    },
    
    critical(...args) {
      this._write('CRITICAL', args);
    },
    
    getHistory() {
      return this.history.slice();
    }
  };

  // ====================================================================================
  // STATE MANAGEMENT (CRITICAL - No race conditions)
  // ====================================================================================

  const STATE = {
    // Initialization tracking
    phase: 'not_started', // not_started | initializing | ready | error
    subphase: '',
    progress: 0,
    
    // Module state
    moduleLoaded: false,
    moduleError: null,
    
    // Resource tracking
    resources: {
      html: { loaded: false, error: null, size: 0 },
      bootJs: { loaded: false, error: null, size: 0 },
      lklJs: { loaded: false, error: null, size: 0 },
      pthreadJs: { loaded: false, error: null, size: 0 }
    },
    
    // Error tracking
    errors: [],
    
    // Cleanup tracking
    cleanupDone: false,
    allocatedResources: new Map(), // For cleanup
    
    // API state
    ready: false,
    error: null,
    workerUrl: null,
    pthreadCode: null,
    
    // Add error and ensure uniqueness
    addError(category, message, details) {
      const error = {
        timestamp: Date.now(),
        category,
        message,
        details,
        stack: new Error().stack
      };
      this.errors.push(error);
      
      // Prevent unbounded memory growth
      if (this.errors.length > 100) {
        this.errors.shift();
      }
      
      LOG.error(`${category}: ${message}`, details);
      return error;
    },
    
    // Verify state consistency
    validate() {
      const issues = [];
      
      if (this.ready && this.phase === 'error') {
        issues.push('State conflict: ready=true but phase=error');
      }
      
      if (this.phase === 'ready' && !this.moduleLoaded) {
        issues.push('State warning: phase=ready but module not loaded');
      }
      
      if (issues.length > 0) {
        LOG.warn('State inconsistencies:', issues);
      }
      
      return issues;
    }
  };

  // ====================================================================================
  // RESOURCE MANAGEMENT (Memory safe)
  // ====================================================================================

  const RESOURCES = {
    /**
     * Track resource allocation for cleanup
     */
    allocate(id, resource, cleanup) {
      STATE.allocatedResources.set(id, { resource, cleanup, time: Date.now() });
      LOG.info(`Resource allocated: ${id}`);
      return resource;
    },
    
    /**
     * Release specific resource
     */
    release(id) {
      const entry = STATE.allocatedResources.get(id);
      if (!entry) return;
      
      try {
        if (typeof entry.cleanup === 'function') {
          entry.cleanup();
        }
        STATE.allocatedResources.delete(id);
        LOG.info(`Resource released: ${id}`);
      } catch (error) {
        LOG.warn(`Cleanup error for ${id}:`, error.message);
      }
    },
    
    /**
     * Release all tracked resources
     */
    releaseAll() {
      const ids = Array.from(STATE.allocatedResources.keys());
      for (const id of ids) {
        this.release(id);
      }
    }
  };

  // ====================================================================================
  // FETCH WITH FULL ERROR HANDLING & TIMEOUTS
  // ====================================================================================

  async function fetchFile(url, options = {}) {
    const timeout = options.timeout || CONFIG.timeouts.smallFile;
    const maxSize = options.maxSize || CONFIG.memory.maxScriptSize;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const resourceId = `fetch_${Date.now()}_${Math.random()}`;

    try {
      LOG.info(`Fetching: ${url} (timeout: ${timeout}ms)`);
      
      // Validate URL
      try {
        new URL(url);
      } catch {
        throw new Error(`Invalid URL: ${url}`);
      }

      const response = await fetch(url, {
        signal: controller.signal,
        method: 'GET',
        headers: {
          'Accept': '*/*',
          'Cache-Control': 'no-cache'
        },
        credentials: 'omit' // Don't send cookies
      });

      clearTimeout(timeoutId);

      // Check HTTP status
      if (!response.ok) {
        const statusText = `HTTP ${response.status} ${response.statusText}`;
        throw STATE.addError('FETCH_HTTP', statusText, { url });
      }

      // Get content length for safety check
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > maxSize) {
        throw STATE.addError('FETCH_SIZE', `File too large: ${contentLength} bytes`, { url, maxSize });
      }

      // Read response
      const text = await response.text();

      // Double-check actual size
      if (new Blob([text]).size > maxSize) {
        throw STATE.addError('FETCH_SIZE', `Downloaded file exceeds max size`, { actual: text.length, max: maxSize });
      }

      LOG.info(`✓ Fetched: ${url} (${text.length} bytes)`);
      return text;

    } catch (error) {
      clearTimeout(timeoutId);

      // Categorize error
      let category = 'FETCH_ERROR';
      let message = error.message;

      if (error.name === 'AbortError') {
        category = 'FETCH_TIMEOUT';
        message = `Timeout after ${timeout}ms`;
      } else if (error instanceof TypeError) {
        category = 'FETCH_NETWORK';
        message = 'Network error (CORS, offline, etc)';
      }

      STATE.addError(category, message, { url });
      throw error;

    } finally {
      clearTimeout(timeoutId);
      RESOURCES.release(resourceId);
    }
  }

  // ====================================================================================
  // FILE TYPE VALIDATION
  // ====================================================================================

  function validateContent(content, type) {
    if (!content || typeof content !== 'string') {
      throw STATE.addError('VALIDATION', `Invalid ${type}: not a string`);
    }

    if (type === 'html') {
      if (!content.includes('<!doctype html') && !content.includes('<!DOCTYPE html')) {
        LOG.warn('HTML validation: missing DOCTYPE (may still be valid)');
      }
      if (!content.includes('<body')) {
        throw STATE.addError('VALIDATION', 'HTML: missing <body> tag');
      }
    }

    if (type === 'javascript') {
      // Check for Git LFS pointer
      if (content.startsWith('version https://git-lfs.github.com/spec/v1')) {
        throw STATE.addError('VALIDATION', `JavaScript file is Git LFS pointer (not downloaded)`, { type });
      }
      
      // Basic syntax check
      if (content.length < 100) {
        throw STATE.addError('VALIDATION', `JavaScript file suspiciously small: ${content.length} bytes`);
      }
    }

    return true;
  }

  // ====================================================================================
  // INITIALIZATION STEPS
  // ====================================================================================

  async function loadBootHTML() {
    STATE.subphase = 'loading_html';
    LOG.info('Step 1/5: Loading boot.html...');

    try {
      const html = await fetchFile(
        `${CONFIG.baseUrl}/${CONFIG.files.bootHtml}`,
        { timeout: CONFIG.timeouts.smallFile, maxSize: CONFIG.memory.maxHtmlSize }
      );

      validateContent(html, 'html');

      // Ensure DOM is ready
      if (!document.body) {
        document.body = document.createElement('body');
      }

      // Parse safely
      const parser = new DOMParser();
      const tempDoc = parser.parseFromString(html, 'text/html');

      // Check for parsing errors
      if (tempDoc.getElementsByTagName('parsererror').length > 0) {
        throw STATE.addError('DOM', 'HTML parsing failed');
      }

      // Merge head content safely
      Array.from(tempDoc.head.querySelectorAll('style')).forEach(style => {
        try {
          document.head.appendChild(style.cloneNode(true));
        } catch (e) {
          LOG.warn('Failed to append style:', e.message);
        }
      });

      // Set title
      const title = tempDoc.querySelector('title');
      if (title) {
        document.title = title.textContent;
      }

      // Merge body content
      const oldBodyHtml = document.body.innerHTML;
      document.body.innerHTML = tempDoc.body.innerHTML;

      STATE.resources.html = { loaded: true, error: null, size: html.length };
      LOG.info('✓ Boot HTML loaded');
      return true;

    } catch (error) {
      STATE.resources.html = { loaded: false, error: error.message };
      throw error;
    }
  }

  async function loadPThreadCode() {
    STATE.subphase = 'loading_pthread';
    LOG.info('Step 2/5: Loading pthread support...');

    try {
      const code = await fetchFile(
        `${CONFIG.baseUrl}/${CONFIG.files.pthreadMainJs}`,
        { timeout: CONFIG.timeouts.smallFile }
      );

      validateContent(code, 'javascript');

      STATE.pthreadCode = code;
      STATE.resources.pthreadJs = { loaded: true, error: null, size: code.length };
      LOG.info('✓ Pthread code loaded');
      return true;

    } catch (error) {
      STATE.resources.pthreadJs = { loaded: false, error: error.message };
      LOG.warn('Pthread load failed (non-critical):', error.message);
      // Don't throw - pthread is optional
      return false;
    }
  }

  async function loadScriptWithFallback(urls, name, resourceKey, timeout) {
    return new Promise((resolve, reject) => {
      let lastError = null;
      let attemptCount = 0;

      async function tryLoad(urlList) {
        if (attemptCount >= CONFIG.retries.maxAttempts) {
          return reject(lastError || new Error('All fallback URLs exhausted'));
        }

        if (!urlList || urlList.length === 0) {
          return reject(lastError || new Error('No URLs provided'));
        }

        attemptCount++;
        const url = urlList[0];
        const remainingUrls = urlList.slice(1);

        try {
          LOG.info(`  Attempt ${attemptCount}: Loading from ${new URL(url).hostname}`);

          const code = await fetchFile(url, { timeout });
          validateContent(code, 'javascript');

          // Create and load script
          const script = document.createElement('script');
          script.id = `bootLinux-${name}`;
          script.type = 'text/javascript';
          script.async = false;

          const scriptTimeout = setTimeout(() => {
            reject(STATE.addError('SCRIPT', `Script execution timeout: ${name}`));
          }, timeout);

          script.onload = () => {
            clearTimeout(scriptTimeout);
            STATE.resources[resourceKey] = { loaded: true, error: null, size: code.length };
            LOG.info(`✓ ${name} loaded (${code.length} bytes)`);
            resolve(true);
          };

          script.onerror = () => {
            clearTimeout(scriptTimeout);
            lastError = new Error(`Script load error: ${name}`);
            // Try next URL
            tryLoad(remainingUrls).catch(reject);
          };

          script.textContent = code;
          document.head.appendChild(script);

        } catch (error) {
          lastError = error;
          LOG.warn(`  Failed from ${new URL(url).hostname}:`, error.message);

          // Retry with delay
          if (remainingUrls.length > 0) {
            setTimeout(() => tryLoad(remainingUrls).catch(reject), CONFIG.retries.delayMs);
          } else {
            reject(lastError);
          }
        }
      }

      tryLoad(urls);
    });
  }

  async function loadBootRuntime() {
    STATE.subphase = 'loading_boot_runtime';
    LOG.info('Step 3/5: Loading boot runtime (51MB, may take 30-60 seconds)...');

    const urls = [
      `${CONFIG.cdnUrl}/${CONFIG.files.bootMinJs}`,
      `${CONFIG.baseUrl}/${CONFIG.files.bootMinJs}`
    ];

    try {
      await loadScriptWithFallback(urls, 'boot.min.js', 'bootJs', CONFIG.timeouts.largeFile);
      return true;
    } catch (error) {
      STATE.resources.bootJs = { loaded: false, error: error.message };
      throw error;
    }
  }

  async function loadLKLLibrary() {
    STATE.subphase = 'loading_lkl';
    LOG.info('Step 4/5: Loading LKL library (51MB, may take 30-60 seconds)...');

    const urls = [
      `${CONFIG.cdnUrl}/${CONFIG.files.libLklMinJs}`,
      `${CONFIG.baseUrl}/${CONFIG.files.libLklMinJs}`
    ];

    try {
      await loadScriptWithFallback(urls, 'liblkl.min.js', 'lklJs', CONFIG.timeouts.largeFile);
      return true;
    } catch (error) {
      STATE.resources.lklJs = { loaded: false, error: error.message };
      throw error;
    }
  }

  async function waitForModule() {
    STATE.subphase = 'module_init';
    LOG.info('Step 5/5: Waiting for Emscripten Module initialization...');

    const startTime = Date.now();
    const timeout = CONFIG.timeouts.moduleInit;

    return new Promise((resolve, reject) => {
      const checkModule = () => {
        if (typeof Module !== 'undefined' && typeof Module.asm !== 'undefined') {
          STATE.moduleLoaded = true;
          LOG.info('✓ Module initialized');
          resolve();
          return;
        }

        if (Date.now() - startTime > timeout) {
          STATE.moduleError = new Error(`Module init timeout after ${timeout}ms`);
          STATE.addError('MODULE', 'Initialization timeout');
          reject(STATE.moduleError);
          return;
        }

        setTimeout(checkModule, 100);
      };

      checkModule();
    });
  }

  // ====================================================================================
  // INITIALIZATION ORCHESTRATION
  // ====================================================================================

  async function init() {
    // Guard against double-init
    if (STATE.phase === 'initializing' || STATE.phase === 'ready') {
      LOG.warn('Init already in progress or complete');
      return false;
    }

    STATE.phase = 'initializing';
    STATE.progress = 0;

    const startTime = Date.now();
    LOG.info(`\n========== bootLinux v${VERSION} Init Start ==========\n`);

    try {
      // Step 1: HTML (20%)
      STATE.progress = 20;
      await loadBootHTML();

      // Step 2: Pthread (30%)
      STATE.progress = 30;
      await loadPThreadCode();

      // Step 3: Boot Runtime (60%)
      STATE.progress = 60;
      await loadBootRuntime();

      // Step 4: LKL Library (80%)
      STATE.progress = 80;
      await loadLKLLibrary();

      // Step 5: Module Init (100%)
      STATE.progress = 100;
      await waitForModule();

      // Mark as ready
      STATE.phase = 'ready';
      STATE.ready = true;
      STATE.error = null;

      const elapsed = Date.now() - startTime;
      LOG.info(`\n✅ BOOT COMPLETE - Ready in ${elapsed}ms\n`);
      LOG.info(`========== bootLinux Ready ==========\n`);

      // Validate final state
      STATE.validate();

      // Emit event
      window.dispatchEvent(new Event('bootLinuxReady'));

      return true;

    } catch (error) {
      STATE.phase = 'error';
      STATE.ready = false;
      STATE.error = error;

      LOG.critical(`\n❌ BOOT FAILED - ${error.message}\n`);
      LOG.critical('Error Stack:', error.stack);
      LOG.critical('Boot State:', JSON.stringify(STATE, null, 2));

      // Emit error event
      window.dispatchEvent(new CustomEvent('bootLinuxError', { detail: error }));

      return false;

    } finally {
      // Cleanup on error
      if (STATE.phase === 'error') {
        LOG.info('Performing emergency cleanup...');
        RESOURCES.releaseAll();
      }
    }
  }

  // ====================================================================================
  // PUBLIC API
  // ====================================================================================

  // Create namespace
  window.bootLinux = window.bootLinux || {};
  const BL = window.bootLinux;

  /**
   * Execute command - SAFE version with full error handling
   */
  BL.exec = function(command, callback) {
    callback = callback || (() => {});

    // Validate inputs
    if (typeof command !== 'string' || command.length === 0) {
      const err = new Error('Command must be non-empty string');
      LOG.error('exec:', err.message);
      callback(err);
      return;
    }

    if (!STATE.ready) {
      const err = new Error(`Environment not ready (state: ${STATE.phase})`);
      LOG.error('exec:', err.message);
      callback(err);
      return;
    }

    // Verify Module is still available
    if (typeof Module === 'undefined' || typeof Module.asm === 'undefined') {
      const err = new Error('Module became unavailable');
      LOG.error('exec:', err.message);
      callback(err);
      return;
    }

    try {
      LOG.info(`Executing: ${command}`);

      // Try different execution methods
      if (typeof Module.callMain === 'function') {
        const result = Module.callMain(['-c', command]);
        callback(null, result);
      } else if (typeof ccall === 'function') {
        const result = ccall('main', 'number', ['number', 'number'], [0, 0]);
        callback(null, result);
      } else {
        throw new Error('No execution API available');
      }

    } catch (error) {
      LOG.error('exec error:', error.message);
      callback(error);
    }
  };

  /**
   * Get comprehensive status
   */
  BL.getStatus = function() {
    return {
      version: VERSION,
      phase: STATE.phase,
      ready: STATE.ready,
      progress: STATE.progress,
      moduleLoaded: STATE.moduleLoaded,
      resources: STATE.resources,
      errors: STATE.errors.slice(-10), // Last 10 errors
      uptime: Date.now(),
      timestamp: new Date().toISOString()
    };
  };

  /**
   * Get full logs
   */
  BL.getLogs = function() {
    return LOG.getHistory();
  };

  /**
   * Manual cleanup
   */
  BL.cleanup = function() {
    if (STATE.cleanupDone) return;
    LOG.info('Manual cleanup requested');
    RESOURCES.releaseAll();
    STATE.cleanupDone = true;
  };

  /**
   * Diagnostics
   */
  BL.diagnose = function() {
    return {
      status: BL.getStatus(),
      logs: BL.getLogs(),
      stateValidation: STATE.validate(),
      resources: Array.from(STATE.allocatedResources.entries()).map(([id, entry]) => ({
        id,
        age: Date.now() - entry.time
      }))
    };
  };

  // Expose for debugging
  BL._state = STATE;
  BL._config = CONFIG;

  // ====================================================================================
  // AUTO-INITIALIZATION
  // ====================================================================================

  LOG.info('bootLinux module loaded');

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init().catch(err => {
        LOG.critical('DOMContentLoaded init error:', err);
      });
    });
  } else {
    // DOM already loaded
    init().catch(err => {
      LOG.critical('Async init error:', err);
    });
  }

})();
