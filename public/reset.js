let toastTimer;
function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

function showError(field, msg) {
  field.classList.add("invalid");
  field.querySelector(".field-error").textContent = msg;
}

function clearError(input) {
  const field = input.closest(".field");
  if (field) {
    field.classList.remove("invalid");
    const err = field.querySelector(".field-error");
    if (err) err.textContent = "";
  }
}

document.querySelectorAll("#resetForm input").forEach((input) => {
  input.addEventListener("input", () => clearError(input));
});

document.getElementById("resetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const password = form.password.value;
  const confirmPassword = form.confirmPassword.value;
  let ok = true;
  if (password.length < 8) {
    showError(form.password.closest(".field"), "密码至少 8 位");
    ok = false;
  }
  if (password !== confirmPassword) {
    showError(form.confirmPassword.closest(".field"), "两次输入的密码不一致");
    ok = false;
  }
  if (!token || !ok) {
    if (!token) showToast("重置链接无效，请重新申请");
    return;
  }
  const btn = form.querySelector("button[type=submit]");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "提交中…";
  try {
    const resp = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ token, password, confirmPassword }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) throw new Error(data.error || `HTTP ${resp.status}`);
    showToast("密码已重置，正在跳转登录");
    setTimeout(() => { window.location.href = "/login.html"; }, 1200);
  } catch (err) {
    showToast(err.message || "重置失败");
    btn.disabled = false;
    btn.textContent = original;
  }
});
