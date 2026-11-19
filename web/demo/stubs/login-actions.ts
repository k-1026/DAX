// 발표용: 로그아웃 버튼을 누르면 비회원 화면으로 돌아간다.
export async function signOut() {
  window.dispatchEvent(new CustomEvent("demo-logout"));
}
