import os
import sys
import paramiko

HOST = "1.201.125.92"
USER = "root"
PUB_KEY_PATH = os.path.expanduser("~/.ssh/id_deploy.pub")

password = os.environ.get("CORVUS_ROOT_PW")
if not password:
    print("ERROR: CORVUS_ROOT_PW env var not set", file=sys.stderr)
    sys.exit(2)

with open(PUB_KEY_PATH, "r", encoding="utf-8") as f:
    pubkey = f.read().strip()

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=password, timeout=15, allow_agent=False, look_for_keys=False)

cmd = (
    "mkdir -p ~/.ssh && chmod 700 ~/.ssh && "
    f"grep -qxF '{pubkey}' ~/.ssh/authorized_keys 2>/dev/null || echo '{pubkey}' >> ~/.ssh/authorized_keys && "
    "chmod 600 ~/.ssh/authorized_keys && echo INSTALL_OK && "
    "tail -n 3 ~/.ssh/authorized_keys | sed 's/\\(AAAA[A-Za-z0-9+/=]\\{20\\}\\).*/\\1.../'"
)
stdin, stdout, stderr = client.exec_command(cmd, timeout=20)
out = stdout.read().decode().strip()
err = stderr.read().decode().strip()
rc = stdout.channel.recv_exit_status()

print("STDOUT:", out)
if err:
    print("STDERR:", err)
print("EXIT:", rc)
client.close()
sys.exit(rc)
