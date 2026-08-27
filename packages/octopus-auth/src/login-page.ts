export function renderLoginPage(options: { needsSetup: boolean }): string {
  const setupNotice = options.needsSetup
    ? `<div class="notice">尚未配置初始管理员：请在 dsh profile 配置中设置 octopus-auth.bootstrapAdmin 后重启。</div>`
    : ""
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>登录 · 工作台</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f5f6f8; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  .card { background: #fff; padding: 2rem; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08); width: 320px; }
  h1 { font-size: 1.1rem; margin: 0 0 1rem; }
  label { display: block; font-size: .85rem; color: #555; margin: .75rem 0 .25rem; }
  input { width: 100%; box-sizing: border-box; padding: .5rem; border: 1px solid #ccc; border-radius: 6px; }
  button { margin-top: 1rem; width: 100%; padding: .55rem; border: 0; border-radius: 6px; background: #2563eb; color: #fff; cursor: pointer; }
  .error { color: #dc2626; font-size: .85rem; margin-top: .75rem; min-height: 1.2em; }
  .notice { color: #b45309; font-size: .85rem; margin-bottom: 1rem; }
</style>
</head>
<body>
<div class="card">
  <h1>工作台登录</h1>
  ${setupNotice}
  <form id="login-form">
    <label for="username">用户名</label>
    <input id="username" name="username" autocomplete="username" required>
    <label for="password">密码</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">登 录</button>
    <div class="error" id="error"></div>
  </form>
</div>
<script>
(function () {
  var form = document.getElementById("login-form");
  var errorEl = document.getElementById("error");
  var params = new URLSearchParams(location.search);
  var rawRedirect = params.get("redirect") || "/workbench";
  var redirect = /^\\/(?!\\/)/.test(rawRedirect) ? rawRedirect : "/workbench";
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errorEl.textContent = "";
    fetch("/api/octopus-auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById("username").value,
        password: document.getElementById("password").value
      })
    }).then(function (res) {
      if (res.ok) { location.href = redirect; return; }
      return res.json().then(function (data) {
        errorEl.textContent = data.error === "rate-limited"
          ? (data.message || "尝试过于频繁，请稍后再试")
          : "用户名或密码错误";
      });
    }).catch(function () { errorEl.textContent = "网络错误，请重试"; });
  });
})();
</script>
</body>
</html>`
}
