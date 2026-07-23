const fs = require('fs');
let content = fs.readFileSync('src/pages/POS.js', 'utf8');

const anchorStartIdx = content.indexOf('window.handlePosSelectBestCoupon = () => {');
const anchorEndIdx = content.indexOf('// Global discount type toggles');
if (anchorStartIdx === -1 || anchorEndIdx === -1) {
    console.error('NOT FOUND');
    process.exit(1);
}

const pre = content.substring(0, anchorStartIdx);
const post = content.substring(anchorEndIdx);

const replacement = `window.handlePosSelectBestCoupon = () => { resetCoupon(); closeModal(); showToast('Reverted to best available offer', 'info'); renderCart(cur); };
        
        openModal({
          title: '<i class="fa-solid fa-tags mr-8"></i> Select Offer',
          body: \`
            <div style="padding: 4px">
              <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px">Multiple offers are available. Choose one to apply to this order.</p>
              <div style="display:flex; flex-direction:column; gap:10px">
                \${applicableCoupons.map(c => {
                  const isActive = specialOffer && specialOffer.id === c.id;
                  const discValue = c.type === 'pct' ? Math.min(subtotal * (c.value / 100), c.maxDiscount || Infinity) : c.value;
                  return \\\`
                    <div class="coupon-item \${isActive ? 'active' : ''}" 
                         style="background:var(--bg-elevated); border:2px solid \${isActive ? '#10b981' : 'var(--border)'}; border-radius:12px; padding:12px; cursor:pointer; transition:all 0.2s"
                         onclick="window.handlePosSelectCoupon('\${c.id}')">
                      <div style="display:flex; justify-content:space-between; align-items:center">
                        <div style="display:flex; align-items:center; gap:10px">
                          <div style="width:36px; height:36px; background:\${isActive ? 'rgba(16,185,129,0.1)' : 'var(--bg-base)'}; border-radius:10px; display:flex; align-items:center; justify-content:center">
                            <i class="fa-solid \${c.target === 'birthday' ? 'fa-cake-candles' : 'fa-tag'}" style="color:\${isActive ? '#10b981' : 'var(--text-muted)'}"></i>
                          </div>
                          <div>
                            <div style="font-weight:700; font-size:14px">\${c.name}</div>
                            <div style="font-size:11px; color:var(--text-muted)">\${c.type === 'pct' ? \\\\\`\\\${c.value}% OFF\\\\\` : \\\\\`\\\${cur}\\\${c.value} OFF\\\\\`} \${c.maxDiscount > 0 ? \\\\\`(Max \\\${cur}\\\${c.maxDiscount})\\\\\` : ''}</div>
                          </div>
                        </div>
                        <div style="text-align:right">
                          <div style="font-weight:900; font-size:16px; color:#10b981">-\${cur}\${discValue.toFixed(2)}</div>
                          <div style="font-size:10px; color:var(--text-muted)">Projected Saving</div>
                        </div>
                      </div>
                      \${isActive ? \\\`
                        <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(16,185,129,0.2); display:flex; align-items:center; color:#059669; font-size:11px; font-weight:700">
                          <i class="fa-solid fa-circle-check mr-6"></i> Currently Applied
                        </div>
                      \\\` : ''}
                    </div>
                  \\\`;
                }).join('')}
              </div>
            </div>
            <style>
              .coupon-item:hover { transform: translateY(-2px); border-color: #10b981 !important; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
              .coupon-item.active { background: rgba(16, 185, 129, 0.05); }
            </style>
          \`,
          footer: \`
            <div style="display:flex; gap:10px; width:100%">
              <button class="btn btn-secondary flex-1" onclick="closeModal()">Close</button>
              <button class="btn btn-primary flex-1" onclick="window.handlePosSelectBestCoupon()">Reset to Best</button>
            </div>
          \`
        });
      });
    }
  }

  `;

fs.writeFileSync('src/pages/POS.js', pre + replacement + post);
