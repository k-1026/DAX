import os

from dotenv import load_dotenv
from google import genai

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
MODEL_NAME = os.getenv("MODEL_NAME")

if not GEMINI_API_KEY:
    raise RuntimeError(".env에 GEMINI_API_KEY가 설정되어 있지 않습니다.")
if not MODEL_NAME:
    raise RuntimeError(".env에 MODEL_NAME이 설정되어 있지 않습니다.")

client = genai.Client(api_key=GEMINI_API_KEY)


if __name__ == "__main__":
    # 연결 테스트: 짧은 프롬프트 1회 호출
    print(f"MODEL_NAME: {MODEL_NAME}")
    response = client.models.generate_content(
        model=MODEL_NAME,
        contents="안녕하세요. 한 문장으로 자기소개 해주세요.",
    )
    print(response.text)
