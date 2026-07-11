const bootLinux = (() => {
    const state = { ready: false, error: null, phase: 'init' };
    const baseUrl = 'https://raw.githubusercontent.com/chinmay1014/Linux/master';
    
    const log = (msg) => console.log('[bootLinux] ' + msg);
    
    const fetchFile = (url) => fetch(url).then(r => r.ok ? r.text() : Promise.reject(`HTTP ${r.status}`));
    
    const injectScript = (code) => {
        const s = document.createElement('script');
        s.textContent = code;
        document.head.appendChild(s);
    };
    
    const injectHTML = (html) => {
        document.body.innerHTML = html;
    };
    
    const checkModule = (callback) => {
        if (typeof Module !== 'undefined' && Module.asm) {
            log('Module ready');
            callback();
        } else {
            setTimeout(() => checkModule(callback), 100);
        }
    };
    
    const loadHTML = () => fetchFile(baseUrl + '/boot.html').then(html => {
        injectHTML(html);
        log('HTML loaded');
    });
    
    const loadPthread = () => fetchFile(baseUrl + '/pthread-main.js').then(code => {
        injectScript(code);
        log('pthread loaded');
    }).catch(() => log('pthread skipped'));
    
    const loadBoot = () => fetchFile(baseUrl + '/boot.min.js').then(code => {
        injectScript(code);
        log('boot loaded');
    });
    
    const loadLKL = () => fetchFile(baseUrl + '/liblkl.min.js').then(code => {
        injectScript(code);
        log('lkl loaded');
    });
    
    const init = () => {
        log('starting');
        loadHTML()
            .then(() => loadPthread())
            .then(() => loadBoot())
            .then(() => loadLKL())
            .then(() => new Promise(resolve => checkModule(resolve)))
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
            if (typeof Module === 'undefined') return cb('no module');
            if (typeof Module.callMain !== 'function') return cb('callMain missing');
            
            try {
                Module.callMain(['-c', cmd]);
                cb(null);
            } catch (err) {
                cb(err);
            }
        }
    };
})();
        
