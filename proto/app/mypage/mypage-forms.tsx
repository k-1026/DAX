"use client";
// 마이페이지의 입력 양식
import { useActionState } from "react";
import {
  changeOptionalConsent,
  savePreferences,
  updateProfile,
  uploadAvatar,
  type MypageState,
} from "./actions";

function Feedback({ state }: { state: MypageState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="text-sm text-green-700">
        {state.message}
      </p>
    );
  }
  return null;
}

export function ProfileForm({
  displayName,
  contactEmail,
}: {
  displayName: string;
  contactEmail: string;
}) {
  const [state, action, pending] = useActionState<MypageState, FormData>(
    updateProfile,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        이름
        <input
          name="displayName"
          defaultValue={displayName}
          maxLength={30}
          autoComplete="name"
          className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        메일 수신 주소
        <input
          name="contactEmail"
          type="email"
          defaultValue={contactEmail}
          autoComplete="email"
          className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
        />
        <span className="text-xs text-zinc-600 dark:text-zinc-400">
          주소를 지우면 추천 메일 수신 동의도 함께 철회됩니다.
        </span>
      </label>
      <Feedback state={state} />
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "저장 중…" : "저장"}
      </button>
    </form>
  );
}

export function OptionalConsentRow({
  type,
  label,
  agreedAt,
}: {
  type: "behavior_tracking" | "email";
  label: string;
  agreedAt: string | null;
}) {
  const [state, action, pending] = useActionState<MypageState, FormData>(
    changeOptionalConsent,
    {},
  );
  const agreed = agreedAt !== null;

  return (
    <form action={action} className="flex flex-col gap-2 py-3">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="agree" value={agreed ? "false" : "true"} />
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm">
          <p className="font-medium">[선택] {label}</p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            {agreed ? `${agreedAt} 동의` : "동의하지 않음"}
          </p>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700"
        >
          {agreed ? "동의 철회" : "동의하기"}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export type Preferences = {
  gu?: string[];
  rent_max?: number;
  deposit_max?: number;
  area_min?: number;
  area_max?: number;
};

const PREF_FIELDS = [
  { name: "rent_max", label: "월 임대료 상한", unit: "만원" },
  { name: "deposit_max", label: "보증금 상한", unit: "만원" },
  { name: "area_min", label: "전용면적 최소", unit: "㎡" },
  { name: "area_max", label: "전용면적 최대", unit: "㎡" },
] as const;

export function PreferencesForm({ areas, saved }: { areas: string[]; saved: Preferences }) {
  const [state, action, pending] = useActionState<MypageState, FormData>(savePreferences, {});
  const input = "w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700";

  return (
    <form action={action} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm">지역 (여러 곳 선택 가능)</legend>
        <div className="flex flex-wrap gap-2">
          {areas.map((gu) => (
            <label key={gu} className="flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
              <input type="checkbox" name="gu" value={gu} defaultChecked={saved.gu?.includes(gu)} />
              {gu}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        {PREF_FIELDS.map((field) => (
          <label key={field.name} className="flex flex-col gap-1 text-sm">
            {field.label} ({field.unit})
            <input name={field.name} type="number" min={0} inputMode="numeric" defaultValue={saved[field.name]} className={input} />
          </label>
        ))}
      </div>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        비워 둔 칸은 조건 없음이에요. 월 임대료 = 월세 + 관리비예요.
      </p>
      <Feedback state={state} />
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "저장 중…" : "선호 조건 저장"}
      </button>
    </form>
  );
}

export function AvatarUploadForm() {
  const [state, action, pending] = useActionState<MypageState, FormData>(uploadAvatar, {});
  return (
    <form action={action} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          name="avatar"
          type="file"
          aria-label="프로필 사진 파일"
          title="JPG·PNG·WebP, 2MB 이하"
          accept="image/jpeg,image/png,image/webp"
          className="min-w-0 flex-1 text-sm file:mr-2 file:rounded-lg file:border file:border-zinc-300 file:bg-transparent file:px-3 file:py-1 dark:file:border-zinc-700"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
        >
          {pending ? "올리는 중…" : "저장"}
        </button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
