// ============ 登录/注册切换 ============
const tabs = document.querySelectorAll(".auth-tab");
const underline = document.getElementById("tabUnderline");
const panels = document.querySelectorAll(".form-panel");

function setMode(mode) {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
  panels.forEach((p) => p.classList.toggle("active", p.id === `${mode}Form`));
  underline.style.transform = mode === "register" ? "translateX(100%)" : "translateX(0)";
}
tabs.forEach((t) => t.addEventListener("click", () => setMode(t.dataset.mode)));
setMode("login");

// ============ 密码显示切换 ============
document.querySelectorAll(".toggle-pwd").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = btn.parentElement.querySelector("input");
    input.type = input.type === "password" ? "text" : "password";
  });
});

// ============ 密码强度 ============
const regPwd = document.querySelector('#registerForm input[name="password"]');
const strength = document.getElementById("pwdStrength");
regPwd.addEventListener("input", () => {
  const v = regPwd.value;
  let score = 0;
  if (v.length >= 8) score++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
  if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) score++;
  strength.className = "pwd-strength" + (score ? ` s${score}` : "");
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

function validateForm(form) {
  let ok = true;
  form.querySelectorAll(".field").forEach((field) => {
    const input = field.querySelector("input");
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
  const terms = form.querySelector('input[name="terms"]');
  if (terms && !terms.checked) {
    showToast("请先同意服务条款");
    ok = false;
  }
  return ok;
}

// ============ 提交 ============
document.getElementById("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  if (!validateForm(form)) return;
  const btn = form.querySelector("button[type=submit]");
  btn.textContent = "登录中…"; btn.disabled = true;
  setTimeout(() => {
    localStorage.setItem("oc_user", form.email.value);
    window.location.href = "index.html";
  }, 700);
});

document.getElementById("registerForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  if (!validateForm(form)) return;
  const btn = form.querySelector("button[type=submit]");
  btn.textContent = "创建中…"; btn.disabled = true;
  setTimeout(() => {
    localStorage.setItem("oc_user", form.email.value);
    showToast("账号创建成功，正在进入…");
    setTimeout(() => (window.location.href = "index.html"), 800);
  }, 700);
});

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
