"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initialState);

  return (
    <form action={action} className="login-form">
      <label>
        <span>อีเมล</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
        />
      </label>
      <label>
        <span>รหัสผ่าน</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="อย่างน้อย 8 ตัวอักษร"
          minLength={8}
          required
        />
      </label>
      {state.error ? (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        {pending ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
      </button>
    </form>
  );
}

