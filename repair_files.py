import os

def fix_settings():
    path = r'd:\pos\src\pages\Settings.js'
    if not os.path.exists(path):
        print(f'Path not found: {path}')
        return
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    # Remove escaped backticks and interpolation
    fixed = content.replace('\\`', '`').replace('\\${', '${')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(fixed)
    print('Fixed Settings.js')

def fix_style():
    path = r'd:\pos\src\style.css'
    if not os.path.exists(path):
        print(f'Path not found: {path}')
        return
    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()
    
    # Surgical truncation
    marker = '.loader-text.pos-style {'
    pos = content.find(marker)
    if pos != -1:
        end_brace = content.find('}', pos)
        if end_brace != -1:
            clean = content[:end_brace+1]
            # Add back the missing styles correctly
            clean += '\n\n/* WhatsApp Settings Tab Specific Styles */\n'
            clean += '.wa-tab-btn { transition: all 0.2s ease; }\n'
            clean += '.wa-tab-btn:hover { background: rgba(0,0,0,0.05); }\n'
            clean += '.wa-tab-btn.active { color: var(--primary) !important; }\n'
            clean += '#waBillPreview { background: #e5ddd5; padding: 20px; border-radius: 8px; font-family: \"Helvetica Neue\", Helvetica, Arial, sans-serif; min-height: 200px; display: flex; align-items: flex-start; justify-content: center; color: black; }\n'
            clean += '.wa-manual-remind-btn { transition: transform 0.1s; }\n'
            clean += '.wa-manual-remind-btn:active { transform: scale(0.95); }\n'
            with open(path, 'w', encoding='utf-8') as f:
                f.write(clean)
            print('Fixed style.css')

if __name__ == '__main__':
    fix_settings()
    fix_style()
