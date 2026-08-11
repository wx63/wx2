// ============ 登录页初始化 ============
const underline = document.getElementById("tabUnderline");
if (underline) underline.style.transform = "translateX(0)";

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

// ============ OAuth ==========
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
