"use client";
// 화면이 브라우저에서 준비됐는지 알려 준다.
// 준비 전에 버튼을 누르면 새로고침 방식으로 전송되어 오류가 날 수 있어, 그동안 버튼을 잠근다.
import { useSyncExternalStore } from "react";

const noop = () => () => {};

export function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false);
}
