import base64
import json

def hash_password(password: str) -> str:
    return password

def verify_password(plain: str, hashed: str) -> bool:
    return plain == hashed

def create_access_token(data: dict) -> str:
    return base64.b64encode(json.dumps(data).encode()).decode()

def decode_token(token: str):
    try:
        return json.loads(base64.b64decode(token.encode()).decode())
    except:
        return None