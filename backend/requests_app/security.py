import hashlib
import hmac
import os

from cryptography.fernet import Fernet, InvalidToken


def _fernet():
    key = os.getenv('PII_ENCRYPTION_KEY', '')
    if not key:
        raise RuntimeError('PII_ENCRYPTION_KEY is required to process personal data.')
    return Fernet(key.encode())


def encrypt_value(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt_value(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken as error:
        raise ValueError('Stored personal data could not be decrypted.') from error


def cpf_digest(normalized_cpf: str) -> str:
    key = os.getenv('CPF_INDEX_KEY', '').encode()
    if not key:
        raise RuntimeError('CPF_INDEX_KEY is required to process personal data.')
    return hmac.new(key, normalized_cpf.encode(), hashlib.sha256).hexdigest()


def mask_cpf(normalized_cpf: str) -> str:
    return f'***.***.***-{normalized_cpf[-2:]}'