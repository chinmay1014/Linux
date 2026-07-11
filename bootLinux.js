const bootLinux = (() => {
    let isRuntimeReady = false;
    let runtimeResolve = null;

    const state = { ready: false, error: null, phase: 'init' };
    const baseUrl = 'https://raw.githubusercontent.com/chinmay1014/Linux/master';
    
    const log = (msg) => console.log('[bootLinux] ' + msg);
    const fetchFile = (url) => fetch(url).then(r => r.ok ? r.text() : Promise.reject(`HTTP ${r.status}`));
    
    const injectScript = (code) => {
        try {
            const s = document.createElement('script');
            s.textContent = code;
            document.head.appendChild(s);
            document.head.removeChild(s);
        } catch (err) {
            return Promise.reject(err);
        }
        return Promise.resolve();
    };
    
    const injectHTML = (html) => {
        const container = document.createElement('div');
        container.id = 'linux-boot-container';
        container.innerHTML = html;
        document.body.appendChild(container);
    };

    const setupEmscriptenHook = () => {
        window.Module = window.Module || {};
        const existingHook = window.Module.onRuntimeInitialized;
        window.Module.onRuntimeInitialized = () => {
            if (typeof existingHook === 'function') existingHook();
            isRuntimeReady = true;
            if (runtimeResolve) runtimeResolve();
        };
    };

    const waitForRuntime = () => {
        return new Promise((resolve, reject) => {
            if (isRuntimeReady) return resolve();
            runtimeResolve = resolve;

            setTimeout(() => {
                if (!isRuntimeReady) {
                    reject(new Error('OS boot timed out (Wasm failed to initialize)'));
                }
            }, 10000);
        });
    };
    
    const loadHTML = () => fetchFile(baseUrl + '/boot.html').then(html => {
        injectHTML(html);
        log('HTML loaded');
    });
    
    const loadBoot = () => fetchFile(baseUrl + '/boot.min.js').then(code => {
        return injectScript(code).then(() => log('boot loaded'));
    });
    
    const loadLKL = () => fetchFile(baseUrl + '/liblkl.min.js').then(code => {
        return injectScript(code).then(() => log('lkl loaded'));
    });
    
    const init = () => {
        log('starting');
        loadHTML()
            .then(() => {
                setupEmscriptenHook(); 
                return loadBoot();
            })
            .then(() => {
                return Promise.all([
                    loadLKL(),
                    waitForRuntime()
                ]);
            })
            .then(() => {
                state.ready = true;
                state.phase = 'ready';
                log('ready');
            })
            .catch(e => {
                state.error = e;
                state.phase = 'error';
                log('error: ' + e);
            });
    };
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    return {
        getStatus: () => state,
        exec: (cmd, cb) => {
            if (!state.ready) return cb('not ready');
            
            try {
                if (typeof Module.callMain === 'function') {
                    Module.callMain(['-c', cmd]);
                    cb(null);
                } else {
                    cb('callMain missing or already executed');
                }
            } catch (err) {
                cb(err);
            }
        }
    };
})();
                   
