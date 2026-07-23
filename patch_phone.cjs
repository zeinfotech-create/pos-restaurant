const fs = require('fs');
let code = fs.readFileSync('src/pages/Kiosk.js', 'utf8');

const startMarker = '    function renderPhone() {';
const endMarker = '    function renderMenu() {';

const si = code.indexOf(startMarker);
const ei = code.indexOf(endMarker);

if (si < 0 || ei < 0) { console.log('markers not found', si, ei); process.exit(1); }

const newFn = `    function renderPhone() {
        container.innerHTML = \`
            <div class="pos-kiosk-page animate-fade-in">
                <div class="pos-top-nav">
                    <button class="pos-back-btn" id="backToSelectionBtn">
                        <i class="fa-solid fa-arrow-left"></i> Back
                    </button>
                    <div style="flex:1"></div>
                </div>
                
                <div style="flex:1; display:flex; align-items:center; justify-content:center; padding: 2rem 4rem; gap: 5rem; background: var(--bg-app);">
                    
                    <!-- Left: Info + Digit display -->
                    <div style="display:flex; flex-direction:column; align-items:flex-start; gap: 2rem; flex:1; max-width: 500px;">
                        <div style="display:flex; align-items:center; gap: 1.5rem;">
                            <div style="width:64px; height:64px; background: var(--primary); border-radius:18px; display:flex; align-items:center; justify-content:center; color:white; font-size:1.75rem; box-shadow:0 0 20px rgba(79,70,229,0.3);">
                                <i class="fa-solid fa-mobile-screen-button"></i>
                            </div>
                            <div>
                                <h2 style="font-size:2.25rem; font-weight:800; color:var(--text-primary); margin:0 0 0.25rem 0;">Your Receipt</h2>
                                <p style="color:var(--text-secondary); font-size:1.05rem; margin:0;">Enter your 10-digit phone number</p>
                            </div>
                        </div>

                        <div style="display:flex; align-items:center; gap:1rem;">
                            <div style="background:var(--bg-surface); border:1px solid var(--border); border-radius:12px; padding:0.6rem 1.1rem; font-size:1.2rem; font-weight:700; color:var(--text-secondary);">🇮🇳 +91</div>
                            <div style="height:2px; flex:1; background:var(--border); border-radius:2px;"></div>
                        </div>

                        <div id="phoneDisplay" style="display:flex; align-items:center; gap:0.5rem;">
                            \${Array.from({length: 10}, (_, i) => \`
                                <div id="digit-\${i}" style="
                                    width:52px; height:66px;
                                    background:var(--bg-surface);
                                    border:2px solid var(--border);
                                    border-radius:14px;
                                    display:flex; align-items:center; justify-content:center;
                                    font-size:1.9rem; font-weight:800;
                                    color:var(--text-secondary);
                                    transition:all 0.15s ease;
                                    \${i === 5 ? 'margin-left:0.75rem;' : ''}
                                ">·</div>
                            \`).join('')}
                        </div>

                        <div style="width:100%; background:var(--border); border-radius:100px; overflow:hidden; height:5px;">
                            <div id="digitProgress" style="height:5px; background: linear-gradient(90deg, var(--primary), var(--primary-light, var(--primary))); border-radius:100px; transition:width 0.2s ease; width:0%;"></div>
                        </div>

                        <div style="display:flex; gap:1rem; width:100%;">
                            <button class="pos-btn pos-btn-outline" id="skipPhoneBtn" style="flex:1; padding:1.1rem; font-size:1.05rem;">Skip</button>
                            <button class="pos-btn" id="placeKioskOrderBtn" disabled style="flex:2; padding:1.1rem; font-size:1.05rem; opacity:0.4;">
                                <i class="fa-solid fa-check"></i> Confirm Order
                            </button>
                        </div>
                    </div>

                    <!-- Right: Numpad -->
                    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:1rem; flex-shrink:0;">
                        \${[1,2,3,4,5,6,7,8,9].map(n => \`
                            <button class="numpad-key" data-val="\${n}" style="width:108px;height:108px;background:var(--bg-surface);border:1.5px solid var(--border);border-radius:20px;font-size:2.5rem;font-weight:700;color:var(--text-primary);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:0.12s;box-shadow:var(--shadow-sm);">\${n}</button>
                        \`).join('')}
                        <button class="numpad-key" data-action="clear" style="width:108px;height:108px;background:var(--bg-surface);border:1.5px solid var(--border);border-radius:20px;font-size:1.5rem;color:var(--text-secondary);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:0.12s;"><i class="fa-solid fa-xmark"></i></button>
                        <button class="numpad-key" data-val="0" style="width:108px;height:108px;background:var(--bg-surface);border:1.5px solid var(--border);border-radius:20px;font-size:2.5rem;font-weight:700;color:var(--text-primary);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:0.12s;box-shadow:var(--shadow-sm);">0</button>
                        <button class="numpad-key" data-action="back" style="width:108px;height:108px;background:var(--bg-surface);border:1.5px solid var(--border);border-radius:20px;font-size:1.75rem;color:var(--primary);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:0.12s;"><i class="fa-solid fa-delete-left"></i></button>
                    </div>
                </div>
            </div>
        \`;

        const MASKED = new Set([2, 3, 6, 7, 8]);
        const placeBtn = document.getElementById('placeKioskOrderBtn');
        const progressBar = document.getElementById('digitProgress');

        const updateDisplay = () => {
            for (let i = 0; i < 10; i++) {
                const box = document.getElementById(\`digit-\${i}\`);
                if (!box) continue;
                if (i < customerPhone.length) {
                    box.textContent = MASKED.has(i) ? '●' : customerPhone[i];
                    box.style.borderColor = 'var(--primary)';
                    box.style.background = 'var(--bg-elevated)';
                    box.style.color = MASKED.has(i) ? 'var(--text-secondary)' : 'var(--text-primary)';
                    box.style.fontSize = MASKED.has(i) ? '1.2rem' : '1.9rem';
                    box.style.boxShadow = 'none';
                } else if (i === customerPhone.length) {
                    box.textContent = '·';
                    box.style.borderColor = 'var(--primary)';
                    box.style.boxShadow = '0 0 0 4px rgba(79,70,229,0.15)';
                    box.style.color = 'var(--primary)';
                    box.style.background = 'var(--bg-surface)';
                    box.style.fontSize = '1.9rem';
                } else {
                    box.textContent = '·';
                    box.style.borderColor = 'var(--border)';
                    box.style.boxShadow = 'none';
                    box.style.color = 'var(--text-secondary)';
                    box.style.background = 'var(--bg-surface)';
                    box.style.fontSize = '1.9rem';
                }
            }
            if (progressBar) progressBar.style.width = \`\${customerPhone.length * 10}%\`;
            if (customerPhone.length === 10) {
                placeBtn.disabled = false; placeBtn.style.opacity = '1';
            } else {
                placeBtn.disabled = true; placeBtn.style.opacity = '0.4';
            }
        };
        updateDisplay();

        container.querySelectorAll('.numpad-key').forEach(btn => {
            btn.addEventListener('pointerdown', () => { btn.style.transform = 'scale(0.91)'; btn.style.background = 'var(--bg-elevated)'; });
            btn.addEventListener('pointerup', () => { btn.style.transform = ''; btn.style.background = 'var(--bg-surface)'; });
            btn.onclick = () => {
                const val = btn.dataset.val, action = btn.dataset.action;
                if (val !== undefined && customerPhone.length < 10) customerPhone += val;
                else if (action === 'back' && customerPhone.length > 0) customerPhone = customerPhone.slice(0, -1);
                else if (action === 'clear') customerPhone = '';
                updateDisplay();
            };
        });

        document.getElementById('backToSelectionBtn')?.addEventListener('click', () => { kioskState = 'checkout'; updateUI(); });
        document.getElementById('skipPhoneBtn')?.addEventListener('click', () => { placeKioskOrder(); });
        placeBtn?.addEventListener('click', () => { placeKioskOrder(); });
    }

`;

code = code.slice(0, si) + newFn + code.slice(ei);
fs.writeFileSync('src/pages/Kiosk.js', code);
console.log('Done! Lines:', code.split('\n').length);
