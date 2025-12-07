# gallery_config.py

disable_logs = False
use_polling_observer = False

def gallery_log(*args, **kwargs):
    if not disable_logs:
        print(*args, **kwargs)
