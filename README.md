 Telegram Bot 和诈骗数据库管理界面
一个基于cloudflare worker的telegram 消息转发bot，集成了反欺诈功能

## 特点
- 基于cloudflare worker搭建，能够实现以下效果
    - 搭建成本低，一个js文件即可完成搭建
    - 不需要额外的域名，利用worker自带域名即可
    - 基于worker D1实现永久数据储存
    - 稳定，全球cdn转发
- 接入反欺诈系统，当聊天对象有诈骗历史时，自动发出提醒
- 支持屏蔽用户，避免被骚扰

## 搭建方法
1. 从[@BotFather](https://t.me/BotFather)获取token，并且可以发送`/setjoingroups`来禁止此Bot被添加到群组
2. 从[uuidgenerator](https://www.uuidgenerator.net/)获取一个随机uuid作为secret
3. 从[@username_to_id_bot](https://t.me/username_to_id_bot)获取你的用户id
4. 登录[cloudflare](https://workers.cloudflare.com/)，创建一个worker[worker代码](./worker.js)
5. 配置worker的变量
    - 增加一个`BOT_TOKEN`变量，数值为从步骤1中获得的token
    - 增加一个`BOT_SECRET`变量，数值为从步骤2中获得的secret
    - 增加一个`ADMIN_UID`变量，数值为从步骤3中获得的用户id
    - 增加一个`ADMIN_PASSWORD`变量用于登陆网页端密码
6. 创建D1数据库，创建一个D1数据库`telegram-bot-db`，点击`Explore Data`，复制[D1数据库](https://github.com/c-longgggeuorgo/telegram_rebot/blob/main/data/D1%E6%95%B0%E6%8D%AE%E5%BA%93.md),点击`Run all statement`
7. 绑定D1数据库，进入`workes`绑定，变量名`DB`,数据库`telegram-bot-db`
8. 通过打开`https://xxx.workers.dev/registerWebhook`来注册websoket

## 使用方法
- 当其他用户给bot发消息，会被转发到bot创建者
- 用户回复普通文字给转发的消息时，会回复到原消息发送者
- 用户回复`/block`, `/unblock`, `/checkblock`,`/admin`等命令会执行相关指令，**不会**回复到原消息发送者

## 欺诈数据源
- 文件[fraud.db](./fraud.db)为欺诈数据，格式为每行一个uid
- 可以通过pr扩展本数据，也可以通过提issue方式补充
- 提供额外欺诈信息时，需要提供一定的消息出处
