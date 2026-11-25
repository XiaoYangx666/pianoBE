/**
 * 未登录时的最小登录页：完全内联，不引用任何静态资源。
 * 静态目录（含 Studio 前端 bundle、模板、插件、采样）需要令牌，
 * 所以登录必须发生在加载任何前端文件之前。
 */
const LOGIN_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PianoBE Studio · 登录</title>
<style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
        margin: 0; min-height: 100dvh; display: grid; place-items: center;
        background: #091a16; color: #e6f2ee; padding: 24px;
        font: 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    main { width: 100%; max-width: 360px; }
    h1 { margin: 0 0 4px; font-size: 20px; letter-spacing: -.02em; }
    p { margin: 0 0 20px; color: #9db4ac; font-size: 12px; }
    form { display: flex; flex-direction: column; gap: 10px; }
    input, button {
        font: inherit; border-radius: 8px; padding: 10px 12px; border: 1px solid #2b463d;
    }
    input { background: #10231d; color: inherit; }
    input:focus { outline: 2px solid #3fbf92; outline-offset: 1px; }
    button { background: #2f9e78; border-color: #2f9e78; color: #04120e; font-weight: 600; cursor: pointer; }
    button:disabled { opacity: .6; cursor: progress; }
    #error { min-height: 1.6em; margin: 10px 0 0; color: #ff9c9c; font-size: 12px; }
</style>
</head>
<body>
<main>
    <h1>PianoBE Studio</h1>
    <p>需要访问令牌才能加载管理界面。</p>
    <form id="login">
        <input id="token" type="password" placeholder="粘贴访问令牌" autocomplete="off" autofocus />
        <button id="submit" type="submit">登录</button>
    </form>
    <p id="error" role="alert"></p>
</main>
<script>
    const form = document.getElementById("login");
    const input = document.getElementById("token");
    const submit = document.getElementById("submit");
    const error = document.getElementById("error");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const token = input.value.trim();
        if (!token) return;
        submit.disabled = true;
        error.textContent = "";
        try {
            const res = await fetch("/api/session", {
                method: "POST",
                headers: { Authorization: "Bearer " + token },
            });
            if (!res.ok) {
                throw new Error(res.status === 401 ? "令牌无效" : "登录失败（HTTP " + res.status + "）");
            }
            localStorage.setItem("pianobe_studio_token", token);
            localStorage.removeItem("piano_token");
            location.replace("/");
        } catch (err) {
            error.textContent = err && err.message ? err.message : String(err);
            submit.disabled = false;
        }
    });
</script>
</body>
</html>
`;

export function loginPageResponse(): Response {
    return new Response(LOGIN_PAGE, {
        status: 200,
        headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            // 页面完全内联，不允许任何外部资源或跳转
            "content-security-policy":
                "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
            "x-content-type-options": "nosniff",
        },
    });
}
