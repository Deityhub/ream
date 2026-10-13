# One-off: make encrypted test fixtures with an independent tool.
#   python3 -m venv /tmp/venv && /tmp/venv/bin/pip install pypdf cryptography
#   /tmp/venv/bin/python scripts/make-encrypted-fixtures.py
# Not a project dependency; the generated PDFs are committed. Passwords: user "user123", owner "owner456".
from pathlib import Path
from pypdf import PdfReader, PdfWriter

src = Path(__file__).resolve().parent.parent / 'packages/pdf-core/test/fixtures/cups.pdf'
out = src.parent
USER, OWNER = 'user123', 'owner456'

def make(name, algorithm, user=USER):
    w = PdfWriter(clone_from=PdfReader(str(src)))
    w.encrypt(user_password=user, owner_password=OWNER, algorithm=algorithm)
    (out / name).write_bytes(b'') or w.write(str(out / name))
    print('wrote', name, algorithm)

make('enc-rc4-40.pdf', 'RC4-40')
make('enc-rc4-128.pdf', 'RC4-128')
make('enc-aes-128.pdf', 'AES-128')
make('enc-aes-256-r5.pdf', 'AES-256-R5')
make('enc-aes-256.pdf', 'AES-256')
make('enc-owner-only.pdf', 'AES-128', user='')  # opens without a password; owner password still exists
