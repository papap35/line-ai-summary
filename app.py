import os
import logging
from dotenv import load_dotenv

load_dotenv()

from flask import Flask, request, abort
from linebot.v3 import WebhookHandler
from linebot.v3.messaging import (
    Configuration,
    ApiClient,
    MessagingApi,
)
from linebot.v3.webhooks import MessageEvent, TextMessageContent
from linebot.v3.exceptions import InvalidSignatureError

import database as db
from scheduler import start_scheduler

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(name)s: %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

handler = WebhookHandler(os.environ['LINE_CHANNEL_SECRET'])
configuration = Configuration(access_token=os.environ['LINE_CHANNEL_ACCESS_TOKEN'])

db.init_db()
_scheduler = start_scheduler()


@app.route('/health')
def health():
    return {'status': 'ok'}


@app.route('/webhook', methods=['POST'])
def webhook():
    signature = request.headers.get('X-Line-Signature', '')
    body = request.get_data(as_text=True)
    try:
        handler.handle(body, signature)
    except InvalidSignatureError:
        logger.warning("Invalid LINE signature")
        abort(400)
    return 'OK'


@handler.add(MessageEvent, message=TextMessageContent)
def handle_message(event: MessageEvent):
    if event.source.type != 'group':
        return

    group_id = event.source.group_id
    user_id = event.source.user_id
    text = event.message.text

    # 嘗試取得使用者顯示名稱
    display_name = None
    try:
        with ApiClient(configuration) as api_client:
            api = MessagingApi(api_client)
            profile = api.get_group_member_profile(group_id, user_id)
            display_name = profile.display_name
    except Exception:
        pass

    db.save_message(group_id=group_id, user_id=user_id, message=text, display_name=display_name)
    logger.debug("Saved message from %s in group %s", user_id, group_id)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '5000'))
    app.run(host='0.0.0.0', port=port)
