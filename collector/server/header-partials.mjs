export const COLLECTOR_HEAD_PARTIAL = `    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <script src="/auth-boot.js"></script>`;

export const COLLECTOR_HEAD_CSS_PARTIAL = `    <link rel="stylesheet" href="/header-shared.css" />`;

export const COLLECTOR_BRAND_PARTIAL = `<div class="brand-lockup">
                <img class="brand-logo" src="/chanisorn-logo-color.png"
                     srcset="/chanisorn-logo-color.png 1x, /chanisorn-logo-color@2x.png 2x"
                     alt="Chanisorn Group" />
              </div>`;

export const COLLECTOR_AUTH_PARTIAL = `<div class="auth-box">
              <label class="auth-field">
                <span>อีเมล</span>
                <input id="auth-email" placeholder="อีเมลบัญชีที่ตั้งไว้ในระบบ" />
              </label>
              <label class="auth-field">
                <span>รหัสผ่าน</span>
                <input id="auth-password" type="password" placeholder="รหัสผ่าน" />
              </label>
              <div class="auth-actions">
                <button class="primary" id="btn-login">เข้าสู่ระบบ</button>
                <button id="btn-logout">ออกจากระบบ</button>
              </div>
            </div>`;
