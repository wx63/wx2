// ============ 登录页初始化 ============
const authTabs = Array.from(document.querySelectorAll(".auth-tab"));
const formPanels = Array.from(document.querySelectorAll(".form-panel"));
const underline = document.getElementById("tabUnderline");

function positionUnderline() {
  if (!underline) return;
  const visibleTabs = authTabs.filter((tab) => tab.offsetParent !== null);
  if (!visibleTabs.length) return;
  const activeIndex = Math.max(0, visibleTabs.indexOf(document.querySelector(".auth-tab.active")));
  underline.style.width = `calc(${100 / visibleTabs.length}% - 4px)`;
  underline.style.transform = `translateX(${activeIndex * 100}%)`;
}

authTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    authTabs.forEach((t) => t.classList.toggle("active", t === tab));
    formPanels.forEach((panel) => panel.classList.toggle("active", panel.id === `${tab.dataset.mode}Form`));
    positionUnderline();
  });
});

function showForgotPanel(show) {
  const tabs = document.querySelector(".auth-tabs");
  const loginPanel = document.getElementById("loginForm");
  const forgotPanel = document.getElementById("forgotForm");
  const registerPanel = document.getElementById("registerForm");
  if (tabs) tabs.style.display = show ? "none" : "";
  if (loginPanel) loginPanel.classList.toggle("active", !show);
  if (forgotPanel) forgotPanel.classList.toggle("active", show);
  if (registerPanel && !show) registerPanel.classList.toggle("active", false);
  authTabs.forEach((tab) => tab.classList.toggle("active", !show && tab.dataset.mode === "login"));
}

document.getElementById("forgotLink")?.addEventListener("click", (e) => {
  e.preventDefault();
  showForgotPanel(true);
});

document.getElementById("forgotBack")?.addEventListener("click", () => {
  showForgotPanel(false);
  positionUnderline();
});

positionUnderline();

// ============ 密码显示切换 ============
document.querySelectorAll(".toggle-pwd").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = btn.parentElement.querySelector("input");
    input.type = input.type === "password" ? "text" : "password";
  });
});

// ============ 表单校验 ============
function showError(field, msg) {
  field.classList.add("invalid");
  field.querySelector(".field-error").textContent = msg;
}
function clearError(field) {
  field.classList.remove("invalid");
  field.querySelector(".field-error").textContent = "";
}

document.querySelectorAll(".field input").forEach((input) => {
  input.addEventListener("input", () => clearError(input.closest(".field")));
});
document.querySelectorAll(".field input[type=checkbox]").forEach((input) => {
  input.addEventListener("change", () => clearError(input.closest(".field")));
});

function validateForm(form) {
  let ok = true;
  form.querySelectorAll(".field").forEach((field) => {
    const input = field.querySelector("input");
    if (input.type === "checkbox") {
      if (!input.checked) {
        showError(field, "请先阅读并同意注册说明");
        ok = false;
      }
      return;
    }
    if (!input.value.trim()) {
      showError(field, "此项为必填");
      ok = false;
    } else if (input.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value)) {
      showError(field, "邮箱格式不正确");
      ok = false;
    } else if (input.type === "password" && input.value.length < 8) {
      showError(field, "密码至少 8 位");
      ok = false;
    }
  });
  const password = form.querySelector("[name=password]");
  const confirmPassword = form.querySelector("[name=confirmPassword]");
  if (password && confirmPassword && password.value !== confirmPassword.value) {
    showError(confirmPassword.closest(".field"), "两次输入的密码不一致");
    ok = false;
  }
  return ok;
}

async function postAuth(path, body) {
  const resp = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

function setSubmitting(btn, text) {
  const original = btn.dataset.originalText || btn.textContent;
  btn.dataset.originalText = original;
  btn.textContent = text;
  btn.disabled = true;
  return () => { btn.textContent = original; btn.disabled = false; };
}

// ============ 提交 ============
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  if (!validateForm(form)) return;
  const btn = form.querySelector("button[type=submit]");
  const reset = setSubmitting(btn, "登录中…");
  try {
    await postAuth("/api/auth/login", {
      email: form.email.value,
      password: form.password.value,
      remember: !!form.remember?.checked,
    });
    window.location.href = "/";
  } catch (err) {
    reset();
    showToast(err.message || "登录失败");
  }
});

document.getElementById("forgotForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const email = form.email.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError(form.email.closest(".field"), "邮箱格式不正确");
    return;
  }
  const btn = form.querySelector("button[type=submit]");
  const reset = setSubmitting(btn, "发送中…");
  try {
    await postAuth("/api/auth/forgot-password", { email });
    showToast("如果该邮箱已注册，重置邮件已发送");
    form.reset();
    showForgotPanel(false);
    positionUnderline();
  } catch (err) {
    reset();
    showToast(err.message || "发送失败");
  }
});

document.getElementById("registerForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  if (!validateForm(form)) return;
  const btn = form.querySelector("button[type=submit]");
  const reset = setSubmitting(btn, "创建中…");
  try {
    await postAuth("/api/auth/register", {
      name: form.name.value.trim(),
      email: form.email.value,
      password: form.password.value,
      confirmPassword: form.confirmPassword.value,
    });
    window.location.href = "/";
  } catch (err) {
    reset();
    showToast(err.message || "注册失败");
  }
});

// ============ 注册开关 ============
(async () => {
  try {
    const resp = await fetch("/api/auth/register-status");
    const data = await resp.json().catch(() => ({}));
    const enabled = resp.ok && data.ok && data.data && data.data.enabled;
    if (enabled) {
      const note = document.querySelector("#registerForm .auth-note");
      if (note) {
        const role = data.data && data.data.defaultRole;
        note.textContent = role === "operator"
          ? "公开注册已开启，新账号默认可执行运营指令。"
          : "公开注册已开启，新账号默认只读权限。";
      }
      return;
    }

    const registerTab = document.querySelector("[data-mode=register]");
    const registerForm = document.getElementById("registerForm");
    if (registerTab) registerTab.remove();
    if (registerForm) registerForm.remove();
    const loginNote = document.querySelector("#loginForm .auth-note");
    if (loginNote) {
      loginNote.textContent = "公开注册已关闭。首次部署请在 .env 中配置 ADMIN_EMAIL / ADMIN_PASSWORD 初始化管理员账号。";
    }
    positionUnderline();
  } catch {}
})();

// ============ OAuth ============
document.querySelectorAll(".oauth-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    showToast(`${btn.dataset.provider} 登录待接入后端 OAuth`);
  });
});

// ============ Toast ============
let toastTimer;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}
