const fs = require('fs');
let code = fs.readFileSync('src/pages/Kiosk.js', 'utf8');

const replacement = `
        /* Global POS Kiosk Overrides */
        .pos-kiosk-page {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: var(--bg-app);
            color: var(--text-primary);
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
        }

        /* Typography */
        .pos-headline { font-size: 3rem; font-weight: 800; color: var(--text-primary); letter-spacing: -1px; margin-bottom: 0.5rem; }
        .pos-subline { font-size: 1.25rem; font-weight: 500; color: var(--text-secondary); margin-bottom: 2rem; }
        
        /* Buttons */
        .pos-btn {
            background: var(--primary);
            color: #fff;
            border: none;
            padding: 1rem 2rem;
            border-radius: var(--radius-lg, 16px);
            font-size: 1.25rem;
            font-weight: 600;
            cursor: pointer;
            transition: var(--transition, 0.2s);
            box-shadow: var(--shadow-sm, 0 4px 6px rgba(0,0,0,0.1));
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.75rem;
        }
        .pos-btn:active { transform: scale(0.96); }
        .pos-btn-outline {
            background: transparent;
            color: var(--text-primary);
            border: 2px solid var(--border);
            box-shadow: none;
        }
        .pos-btn-outline:hover { background: var(--bg-hover); }

        /* Modern Cards */
        .pos-card {
            background: var(--bg-surface);
            border-radius: var(--radius-lg, 16px);
            border: 1px solid var(--border);
            box-shadow: var(--shadow, 0 4px 12px rgba(0,0,0,0.05));
            padding: 2rem;
            transition: var(--transition, 0.2s);
            cursor: pointer;
        }
        .pos-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 12px 24px rgba(0,0,0,0.1);
            border-color: var(--primary-light);
        }

        /* Specialized Views */
        /* 1. Welcome */
        .pos-welcome-hero {
            flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
            text-align: center; position: relative;
        }
        .pos-welcome-logo { width: 120px; height: 120px; background: var(--primary); border-radius: 30px; display: flex; align-items: center; justify-content: center; margin-bottom: 2rem; color: white; font-size: 4rem; box-shadow: 0 0 30px rgba(79, 70, 229, 0.4); }
        .pos-tap-indicator { margin-top: 3rem; animation: pulse 2s infinite; font-weight: 600; color: var(--primary); display: flex; align-items: center; gap: 0.5rem; font-size: 1.5rem; }
        .tap-overlay { position: absolute; inset: 0; cursor: pointer; z-index: 100; }

        /* 2. Menu Layout */
        .pos-menu-layout { display: flex; height: 100vh; background: var(--bg-app); }
        .pos-sidebar { width: 280px; background: var(--bg-surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; z-index: 20; }
        .pos-sidebar-header { padding: 2rem; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 1rem; }
        .pos-sidebar-nav { flex: 1; overflow-y: auto; padding: 1.5rem 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
        .pos-nav-item { padding: 1rem 1.5rem; border-radius: var(--radius, 12px); font-weight: 600; color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; gap: 1rem; transition: var(--transition, 0.2s); }
        .pos-nav-item:hover { background: var(--bg-hover); color: var(--text-primary); }
        .pos-nav-item.active { background: var(--primary); color: white; box-shadow: var(--shadow-sm); }
        .pos-menu-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative; }
        .pos-menu-header { padding: 2rem 3rem; background: var(--bg-app); z-index: 10; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); }
        
        /* Modern CSS Grid for Products */
        .pos-grid-container { flex: 1; overflow-y: auto; padding-bottom: 120px; }
        .pos-grid { padding: 2rem 3rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.5rem; }
        .pos-product { background: var(--bg-surface); border-radius: var(--radius-lg, 16px); padding: 1.5rem; border: 1px solid var(--border); display: flex; flex-direction: column; gap: 1rem; transition: var(--transition, 0.2s); position: relative; cursor: pointer; }
        .pos-product:hover { border-color: var(--primary); box-shadow: var(--shadow); transform: translateY(-2px); }
        .pos-product-img { height: 160px; background: var(--bg-elevated); border-radius: var(--radius, 12px); display: flex; align-items: center; justify-content: center; font-size: 5rem; margin-bottom: 0.5rem;}
        .pos-product-info { flex: 1; display: flex; flex-direction: column; justify-content: space-between; gap: 0.5rem; }
        .pos-product-name { font-weight: 600; font-size: 1.25rem; line-height: 1.3; color: var(--text-primary); }
        .pos-product-price { color: var(--primary); font-weight: 700; font-size: 1.5rem; }
        .pos-add-btn { position: absolute; bottom: 1.5rem; right: 1.5rem; background: var(--bg-app); color: var(--text-primary); width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); transition: 0.2s; font-size: 1.25rem; z-index: 5;}
        .pos-product:hover .pos-add-btn { background: var(--primary); color: white; border-color: var(--primary); }
        
        /* Subnav Filtering Pills */
        .pos-subnav { display: flex; gap: 0.75rem; padding: 0 3rem 1rem; overflow-x: auto; margin-top: 1rem; }
        .pos-pill { padding: 0.5rem 1.25rem; border-radius: 100px; border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-secondary); font-weight: 600; cursor: pointer; transition: 0.2s; white-space: nowrap; }
        .pos-pill.active { background: var(--text-primary); color: var(--bg-surface); border-color: var(--text-primary); }

        /* Floating Cart Bar */
        .pos-cart-bar { position: absolute; bottom: 2rem; left: 50%; transform: translateX(-50%) translateY(100px); opacity: 0; background: var(--bg-elevated); padding: 1rem 1.5rem; border-radius: 100px; display: flex; align-items: center; gap: 2rem; box-shadow: 0 10px 25px rgba(0,0,0,0.15); border: 1px solid var(--border); transition: 0.4s cubic-bezier(0.4, 0, 0.2, 1); z-index: 100; pointer-events: none; }
        .pos-cart-bar.visible { transform: translateX(-50%) translateY(0); opacity: 1; pointer-events: auto; }
        .pos-cart-info { display: flex; align-items: center; gap: 1rem; color: var(--text-primary); font-weight: 600; font-size: 1.25rem; }
        .pos-cart-badge { background: var(--primary); color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1rem; margin-right: 0.5rem;}
        .pos-cart-checkout { background: var(--primary); color: white; border: none; padding: 0.75rem 2rem; border-radius: 100px; font-weight: 600; font-size: 1.1rem; display: flex; gap: 1rem; cursor: pointer; transition: 0.2s;}
        .pos-cart-checkout:active { transform: scale(0.95); }

        /* Checkout, Phone, Success Layouts */
        .pos-center-layout { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; background: var(--bg-app); min-height: 100vh;}
        .pos-checkout-container { display: flex; gap: 3rem; width: 100%; max-width: 1200px; margin: 0 auto; height: calc(100vh - 140px); }
        .pos-checkout-items { flex: 2; overflow-y: auto; padding-right: 1rem; display: flex; flex-direction: column; gap: 1rem; }
        .pos-checkout-item { background: var(--bg-surface); padding: 1.5rem; border-radius: var(--radius-lg, 16px); border: 1px solid var(--border); display: flex; align-items: center; gap: 1.5rem; }
        .pos-checkout-item-img { width: 80px; height: 80px; background: var(--bg-app); border-radius: var(--radius, 12px); display: flex; align-items: center; justify-content: center; font-size: 2.5rem; }
        .pos-checkout-item-info { flex: 1; display: flex; flex-direction: column; gap: 0.25rem;}
        .pos-checkout-item-name { font-size: 1.25rem; font-weight: 600; color: var(--text-primary); margin: 0;}
        .pos-checkout-item-price { font-size: 1.1rem; color: var(--text-secondary); font-weight: 500;}
        
        /* Checkout Quantity Controls */
        .pos-checkout-qty-controls { display: flex; align-items: center; gap: 1rem; background: var(--bg-app); padding: 0.5rem; border-radius: 100px; border: 1px solid var(--border); }
        .pos-checkout-qty-btn { width: 32px; height: 32px; border-radius: 50%; background: var(--bg-surface); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-primary); }
        .pos-checkout-qty-val { font-weight: 600; width: 24px; text-align: center; }
        .pos-checkout-item-total { font-size: 1.5rem; font-weight: 700; color: var(--text-primary); margin-left: 1rem; width: 80px; text-align: right;}

        .pos-checkout-summary { flex: 1; background: var(--bg-surface); padding: 2.5rem; border-radius: var(--radius-lg, 16px); border: 1px solid var(--border); height: fit-content; display: flex; flex-direction: column; gap: 1rem;}
        .pos-summary-title { font-size: 1.5rem; font-weight: 700; margin-bottom: 1.5rem; margin-top: 0; color: var(--text-primary); }
        .pos-summary-row { display: flex; justify-content: space-between; color: var(--text-secondary); font-size: 1.1rem; }
        .pos-summary-total { display: flex; justify-content: space-between; margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px dashed var(--border); color: var(--text-primary); font-weight: 700; font-size: 1.75rem; }
        
        /* Numpad */
        .pos-numpad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; max-width: 320px; margin: 2rem auto; }
        .pos-numbtn { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg, 16px); height: 80px; display: flex; align-items: center; justify-content: center; font-size: 2rem; font-weight: 600; color: var(--text-primary); cursor: pointer; transition: 0.1s; box-shadow: var(--shadow-sm); }
        .pos-numbtn:active { background: var(--border); transform: scale(0.95); }
        .pos-phone-display { background: var(--bg-surface); border: 2px solid var(--primary); padding: 1.5rem; border-radius: var(--radius-lg, 16px); font-size: 2.5rem; font-weight: 700; letter-spacing: 2px; text-align: center; margin-bottom: 2rem; min-height: 90px; color: var(--text-primary); box-shadow: var(--shadow-glow); }

        /* Modals */
        .kiosk-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.4); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 2000; }
        .kiosk-modal.hidden { display: none; }
        .pos-modal-content { background: var(--bg-surface); width: 600px; border-radius: var(--radius-lg, 16px); border: 1px solid var(--border); overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25); transform: translateY(0); transition: all 0.3s; }
        .pos-modal-header { padding: 3rem; background: var(--bg-app); display: flex; align-items: center; justify-content: center; position: relative; border-bottom: 1px solid var(--border); }
        .pos-modal-emoji { font-size: 8rem; filter: drop-shadow(0 10px 15px rgba(0,0,0,0.1)); }
        .pos-modal-close { position: absolute; top: 1.5rem; right: 1.5rem; background: var(--bg-surface); border: 1px solid var(--border); width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-secondary); font-size: 1.25rem; transition: 0.2s;}
        .pos-modal-close:hover { background: var(--border); color: var(--text-primary); }
        .pos-modal-body { padding: 2.5rem; text-align: center; display: flex; flex-direction: column; align-items: center; }
        .pos-modal-title { font-size: 2.5rem; font-weight: 800; color: var(--text-primary); margin: 0 0 1rem 0; line-height: 1.1; }
        .pos-modal-desc { font-size: 1.1rem; color: var(--text-secondary); margin-bottom: 2rem; max-width: 80%; }
        .pos-modal-price { font-size: 3rem; font-weight: 800; color: var(--primary); margin-bottom: 2rem; }
        
        .pos-qty-controls { display: flex; align-items: center; justify-content: center; gap: 2.5rem; margin-bottom: 2.5rem; background: var(--bg-app); padding: 1rem 2rem; border-radius: 100px; border: 1px solid var(--border); }
        .pos-qty-btn { width: 48px; height: 48px; border-radius: 50%; background: var(--bg-surface); border: 1px solid var(--border); color: var(--text-primary); font-size: 1.5rem; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: 0.2s; box-shadow: var(--shadow-sm); }
        .pos-qty-btn:active { transform: scale(0.9); background: var(--border); }
        .pos-qty-val { font-size: 2.5rem; font-weight: 700; width: 3rem; text-align: center; color: var(--text-primary); }
        
        .pos-modal-footer { padding: 0 2.5rem 2.5rem; }
        .pos-add-to-cart-btn { width: 100%; padding: 1.25rem; background: var(--primary); color: white; border: none; border-radius: var(--radius-lg, 16px); font-size: 1.5rem; font-weight: 700; cursor: pointer; box-shadow: 0 10px 20px rgba(79, 70, 229, 0.2); transition: 0.2s; display: flex; justify-content: center; align-items: center; gap: 1rem;}
        .pos-add-to-cart-btn:active { transform: scale(0.98); }

        /* Animations & Utils */
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
        .animate-fade-in { animation: fadeIn 0.4s ease forwards; }
        .animate-slide-up { animation: slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .custom-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 10px; }
        
        /* Top Navigation Header for sub-pages */
        .pos-top-nav { height: 100px; padding: 0 3rem; display: flex; align-items: center; border-bottom: 1px solid var(--border); background: var(--bg-surface); width: 100%; }
        .pos-back-btn { background: var(--bg-app); border: 1px solid var(--border); color: var(--text-primary); font-weight: 600; padding: 1rem 2rem; border-radius: 100px; font-size: 1.1rem; cursor: pointer; display: flex; align-items: center; gap: 0.75rem; transition: 0.2s; }
        .pos-back-btn:hover { background: var(--bg-hover); }
`;

const lines = code.split('\\n');
const s = lines.findIndex(l => l.includes('style.id = \\'kiosk - styles\\''));
const e = lines.findIndex(l => l.includes('document.head.appendChild(style)'));

if (s > 0 && e > s) {
    lines.splice(s + 1, e - s - 1, 'style.textContent = `', replacement, '`;');
    fs.writeFileSync('src/pages/Kiosk.js', lines.join('\\n'));
    console.log('CSS Replaced Successfully');
} else {
    console.log('Could not find styling block bounds.', s, e);
}
