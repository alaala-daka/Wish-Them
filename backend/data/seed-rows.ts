/**
 * 自动生成，勿手改：源数据是 database/seed/*.json（由 tools/scripts/build-seeds.ts 生成）。
 * 本文件属于 Function 包（backend/），供服务端启动时幂等播种使用；
 * 改内容请改 database/seed/*.ts 后重跑生成脚本。
 */
export type SeedRow = Record<string, unknown>;

export interface SeedTable {
  table: 'wish_templates' | 'task_templates' | 'rewards';
  expected: number;
  rows: SeedRow[];
}

export const SEED_TABLES: SeedTable[] = [
  {
    "table": "wish_templates",
    "expected": 72,
    "rows": [
      {
        "id": "f4307698-4e67-4beb-8ab3-7586e4846f9e",
        "relation": "妈妈",
        "wish_type": "body",
        "content": "妈妈的腰疼能轻一点，晚上睡得沉一些。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 1,
        "is_active": true
      },
      {
        "id": "26338896-0ccb-4678-8a9c-930a0f9adddc",
        "relation": "妈妈",
        "wish_type": "sleep",
        "content": "妈妈别再熬到一点刷手机，十一点前熄灯。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 2,
        "is_active": true
      },
      {
        "id": "dc8b53b8-6f79-4725-8f6d-571c43844111",
        "relation": "妈妈",
        "wish_type": "lonely",
        "content": "妈妈白天一个人说话太少，我想让她每天都有人聊几句。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 3,
        "is_active": true
      },
      {
        "id": "fe233438-1466-46d0-8bf4-807bc6d3240e",
        "relation": "妈妈",
        "wish_type": "study",
        "content": "妈妈想考那个上岗证，一直没时间看书。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 4,
        "is_active": true
      },
      {
        "id": "9d9309a0-7086-4b40-8803-0547eb8cd722",
        "relation": "妈妈",
        "wish_type": "emotion",
        "content": "妈妈最近总叹气，我希望她能笑一次是因为自己。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 5,
        "is_active": true
      },
      {
        "id": "3a7f6d42-6027-4d9d-81dc-11e52ac17809",
        "relation": "妈妈",
        "wish_type": "life",
        "content": "妈妈做饭总在剩菜里对付，我想让她好好吃一顿。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 6,
        "is_active": true
      },
      {
        "id": "91d53090-010e-496b-8082-7b469363f3ce",
        "relation": "爸爸",
        "wish_type": "body",
        "content": "爸爸的血压能稳一点，别再疼着还去跑工地。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 1,
        "is_active": true
      },
      {
        "id": "7a34e2e1-4d2e-468e-8d4c-428e2dc901e8",
        "relation": "爸爸",
        "wish_type": "sleep",
        "content": "爸爸值完夜班能睡足八小时。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 2,
        "is_active": true
      },
      {
        "id": "282add19-34e3-49b6-8f7c-a715a71b3b7e",
        "relation": "爸爸",
        "wish_type": "lonely",
        "content": "爸爸的朋友越来越少，我想让他有人一起下棋。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 3,
        "is_active": true
      },
      {
        "id": "1ff89524-1e73-4727-860f-4315defd5f15",
        "relation": "爸爸",
        "wish_type": "emotion",
        "content": "爸爸从不说自己累，我希望他偶尔能软一次。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 4,
        "is_active": true
      },
      {
        "id": "701776f4-7ff7-4087-87a0-bfc963ff8ed6",
        "relation": "爸爸",
        "wish_type": "life",
        "content": "爸爸那辆骑了八年的电动车，刹车该换了。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 5,
        "is_active": true
      },
      {
        "id": "ae6ee3e2-1fdd-4c48-8fb8-47360747543f",
        "relation": "爸爸",
        "wish_type": "study",
        "content": "爸爸想学会用导航软件，别再嘴上说“看路牌就行”。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 6,
        "is_active": true
      },
      {
        "id": "730aa0fe-bf4b-48f4-8847-3f1cabffc111",
        "relation": "奶奶",
        "wish_type": "body",
        "content": "奶奶的膝盖暖和一点，上下楼不用扶着墙。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 1,
        "is_active": true
      },
      {
        "id": "617dc43a-cf66-438e-863b-1294eb8be607",
        "relation": "奶奶",
        "wish_type": "lonely",
        "content": "奶奶每天就在阳台坐一天，我想让她有人陪说话。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 2,
        "is_active": true
      },
      {
        "id": "af03ff1f-7548-4900-89d6-31f2ff096336",
        "relation": "奶奶",
        "wish_type": "sleep",
        "content": "奶奶夜里醒四五次，能睡个整觉。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 3,
        "is_active": true
      },
      {
        "id": "b0a56251-9875-49cb-848b-ba679c83ba13",
        "relation": "奶奶",
        "wish_type": "emotion",
        "content": "奶奶总怕自己成了负担，我想让她知道她不是。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 4,
        "is_active": true
      },
      {
        "id": "5d4b13c5-2fc5-4bc6-8902-bfbd511e1008",
        "relation": "奶奶",
        "wish_type": "life",
        "content": "奶奶的放大镜旧了，她想自己看药盒上的小字。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 5,
        "is_active": true
      },
      {
        "id": "114af899-69e9-49e6-8516-f55b0a0ce457",
        "relation": "奶奶",
        "wish_type": "study",
        "content": "奶奶想学会视频通话，看清外地的孙子。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 6,
        "is_active": true
      },
      {
        "id": "aa9dd367-0dfe-4ab2-8b65-c11201a6da9c",
        "relation": "爷爷",
        "wish_type": "body",
        "content": "爷爷的耳朵没那么背，听清我们说话。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 1,
        "is_active": true
      },
      {
        "id": "f744d4ed-7aca-492b-8d57-cd5d512c49e6",
        "relation": "爷爷",
        "wish_type": "lonely",
        "content": "爷爷下棋没有对手，我想给他找个能聊天的老伙计。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 2,
        "is_active": true
      },
      {
        "id": "e25a0e99-3de9-48f0-84a9-c8f438ee370c",
        "relation": "爷爷",
        "wish_type": "emotion",
        "content": "爷爷把想念都藏在沉默里，我希望他愿意讲出来。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 3,
        "is_active": true
      },
      {
        "id": "49986e5d-4ab5-4e4a-8869-d613df56a672",
        "relation": "爷爷",
        "wish_type": "life",
        "content": "爷爷的茶杯该换个带滤网的，他总把茶叶喝进嘴里。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 4,
        "is_active": true
      },
      {
        "id": "b4f5f9b6-ceae-4eb3-86a9-1af2143d2634",
        "relation": "爷爷",
        "wish_type": "sleep",
        "content": "爷爷午睡总在半下午，晚上反而睡不着。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 5,
        "is_active": true
      },
      {
        "id": "101f6b07-e86a-4683-8aab-e0523b8775ad",
        "relation": "爷爷",
        "wish_type": "study",
        "content": "爷爷想学会用手机听戏，别再抱着那台收音机。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 6,
        "is_active": true
      },
      {
        "id": "7f5c7b0b-4b8f-4e99-8843-6c22a5dbc3f4",
        "relation": "姥姥",
        "wish_type": "body",
        "content": "姥姥的腿疼能轻一些，别再一个人在家扛着。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 1,
        "is_active": true
      },
      {
        "id": "50f6a6c0-2088-4ac7-83a5-4d1f3e997b03",
        "relation": "姥姥",
        "wish_type": "lonely",
        "content": "姥姥一个人住在老房子，我想让她一周至少热闹一天。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 2,
        "is_active": true
      },
      {
        "id": "7e967e18-0735-416c-8d04-2ea3cbedea72",
        "relation": "姥姥",
        "wish_type": "emotion",
        "content": "姥姥总说“我没事”，我希望她真的有没事的一天。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 3,
        "is_active": true
      },
      {
        "id": "e984b8cc-42bd-4c49-8c5e-49643601d94e",
        "relation": "姥姥",
        "wish_type": "life",
        "content": "姥姥买菜要爬四楼，我想让她少爬几次。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 4,
        "is_active": true
      },
      {
        "id": "9c930cb3-1c65-4894-82e3-dc137ee61a5c",
        "relation": "姥姥",
        "wish_type": "sleep",
        "content": "姥姥夜里一个人，睡不踏实。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 5,
        "is_active": true
      },
      {
        "id": "3c2938ca-5d49-44b2-8b55-47babe96bc83",
        "relation": "姥姥",
        "wish_type": "study",
        "content": "姥姥想学会看天气，别再每天问我三遍。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 6,
        "is_active": true
      },
      {
        "id": "dfbccb7b-63ff-4a15-88ac-dea8f631a018",
        "relation": "姥爷",
        "wish_type": "body",
        "content": "姥爷的腰能撑住他每天去河边坐着钓鱼。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 1,
        "is_active": true
      },
      {
        "id": "9243aacb-bd34-4678-81a7-ffa5e11d9816",
        "relation": "姥爷",
        "wish_type": "lonely",
        "content": "姥爷的话都对着鱼说，我想给他找点人说话的事。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 2,
        "is_active": true
      },
      {
        "id": "6d64b8d0-0eba-45e6-8adb-9acb3c92610d",
        "relation": "姥爷",
        "wish_type": "emotion",
        "content": "姥爷逞强一辈子，我希望他接受一次照顾。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 3,
        "is_active": true
      },
      {
        "id": "18c42c2e-3c78-44f5-8004-44be8a0446ac",
        "relation": "姥爷",
        "wish_type": "life",
        "content": "姥爷的老花镜裂了还戴着，我想让他看清报纸。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 4,
        "is_active": true
      },
      {
        "id": "b8522eb3-319d-48b2-84dd-ac4b5d409ef1",
        "relation": "姥爷",
        "wish_type": "sleep",
        "content": "姥爷凌晨四点就起床，晚上根本睡不着。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 5,
        "is_active": true
      },
      {
        "id": "7775cd02-48cc-47c6-8754-f30cb5f1da26",
        "relation": "姥爷",
        "wish_type": "study",
        "content": "姥爷想学会给自己拍照，别再只拍别人。",
        "tone": "亲近、克制、具体",
        "batch": 1,
        "sort_order": 6,
        "is_active": true
      },
      {
        "id": "5ffef343-74c4-44b6-8945-1805331c3659",
        "relation": "室友",
        "wish_type": "study",
        "content": "室友考研压力大，希望能顺利上岸。",
        "tone": "直接、可开玩笑",
        "batch": 1,
        "sort_order": 1,
        "is_active": true
      },
      {
        "id": "6d233f2d-ce49-44b5-86af-69932d2b4a4e",
        "relation": "室友",
        "wish_type": "emotion",
        "content": "室友最近天天失眠，白天还得强撑着上课。",
        "tone": "直接、可开玩笑",
        "batch": 1,
        "sort_order": 2,
        "is_active": true
      },
      {
        "id": "969c02ce-c0c9-486d-808f-2c8623b54692",
        "relation": "室友",
        "wish_type": "life",
        "content": "室友的桌面永远乱成一团，我想看他收拾干净一次。",
        "tone": "直接、可开玩笑",
        "batch": 1,
        "sort_order": 3,
        "is_active": true
      },
      {
        "id": "c7de980f-6a8a-4da7-8f56-29afd72c28ee",
        "relation": "室友",
        "wish_type": "sleep",
        "content": "室友熬夜打游戏到三点，希望他能睡个早觉。",
        "tone": "直接、可开玩笑",
        "batch": 1,
        "sort_order": 4,
        "is_active": true
      },
      {
        "id": "657e511a-7066-4467-8a93-84d66cf9ab08",
        "relation": "室友",
        "wish_type": "body",
        "content": "室友久坐腰疼，还说不就是坐着嘛。",
        "tone": "直接、可开玩笑",
        "batch": 1,
        "sort_order": 5,
        "is_active": true
      },
      {
        "id": "e5dba760-b6ef-4b18-846d-797af2e04a69",
        "relation": "室友",
        "wish_type": "lonely",
        "content": "室友说自己“习惯了没人”，其实是不敢说。",
        "tone": "直接、可开玩笑",
        "batch": 1,
        "sort_order": 6,
        "is_active": true
      },
      {
        "id": "06733978-5134-46d4-8a00-7515b5da934e",
        "relation": "闺蜜",
        "wish_type": "emotion",
        "content": "闺蜜分手后一直在笑，我想让她有一次能哭出来。",
        "tone": "直接、可开玩笑",
        "batch": 1,
        "sort_order": 1,
        "is_active": true
      },
      {
        "id": "bba1c0c3-f4a7-459f-89fc-a0356df70b51",
        "relation": "闺蜜",
        "wish_type": "study",
        "content": "闺蜜投了四十份简历，希望下一个面试就是她。",
        "tone": "直接、可开玩笑",
        "batch": 1,
        "sort_order": 2,
        "is_active": true
      },
      {
        "id": "6d7860e6-a8a4-41d2-86de-a3248cd7eeb2",
        "relation": "闺蜜",
        "wish_type": "body",
        "content": "闺蜜痛经到吃止疼片，希望她能舒服一点。",
        "tone": "直接、可开玩笑",
        "batch": 1,
        "sort_order": 3,
        "is_active": true
      },
      {
        "id": "15a65c2a-7a88-43a4-89c9-3a67cfe3057e",
        "relation": "闺蜜",
        "wish_type": "life",
        "content": "闺蜜总是照顾别人，我想让她被照顾一次。",
        "tone": "直接、可开玩笑",
        "batch": 1,
        "sort_order": 4,
        "is_active": true
      },
      {
        "id": "5b7bac6d-7245-41f4-8b71-d7908f85a832",
        "relation": "闺蜜",
        "wish_type": "sleep",
        "content": "闺蜜焦虑到凌晨还在刷手机。",
        "tone": "直接、可开玩笑",
        "batch": 1,
        "sort_order": 5,
        "is_active": true
      },
      {
        "id": "cb988077-3af8-458c-8480-ba8a13f2174f",
        "relation": "闺蜜",
        "wish_type": "lonely",
        "content": "闺蜜换了城市，一个新朋友都没有。",
        "tone": "直接、可开玩笑",
        "batch": 1,
        "sort_order": 6,
        "is_active": true
      },
      {
        "id": "1132a316-b2bf-4377-8249-3bcbeab9329e",
        "relation": "兄弟",
        "wish_type": "emotion",
        "content": "兄弟失恋了嘴上说没事，我知道他有事。",
        "tone": "直接、可开玩笑",
        "batch": 1,
        "sort_order": 1,
        "is_active": true
      },
      {
        "id": "9005e7b2-e967-4aac-8a04-be3c27e84d0b",
        "relation": "兄弟",
        "wish_type": "body",
        "content": "兄弟健身把肩练伤了，还不肯去看。",
        "tone": "直接、可开玩笑",
        "batch": 1,
        "sort_order": 2,
        "is_active": true
      },
      {
        "id": "65d3a7ba-7c97-42d8-8328-6c90539c8fe5",
        "relation": "兄弟",
        "wish_type": "study",
        "content": "兄弟要考公，一个人复习太枯燥。",
        "tone": "直接、可开玩笑",
        "batch": 1,
        "sort_order": 3,
        "is_active": true
      },
      {
        "id": "00836508-21f5-47a7-8df9-f42f0b1bab73",
        "relation": "兄弟",
        "wish_type": "life",
        "content": "兄弟天天吃泡面，我想看他正经吃顿饭。",
        "tone": "直接、可开玩笑",
        "batch": 1,
        "sort_order": 4,
        "is_active": true
      },
      {
        "id": "b4b97660-d7f2-4677-881f-b2f7cd677ff5",
        "relation": "兄弟",
        "wish_type": "lonely",
        "content": "兄弟说“兄弟不需要人陪”，这句话最让人担心。",
        "tone": "直接、可开玩笑",
        "batch": 1,
        "sort_order": 5,
        "is_active": true
      },
      {
        "id": "d37fd609-1533-4af7-878b-658dacb6aa5d",
        "relation": "兄弟",
        "wish_type": "sleep",
        "content": "兄弟通宵赶作业，白天睡不醒。",
        "tone": "直接、可开玩笑",
        "batch": 1,
        "sort_order": 6,
        "is_active": true
      },
      {
        "id": "a1d8ed59-1d45-4a0c-8bd3-4bd83baac221",
        "relation": "恋人",
        "wish_type": "emotion",
        "content": "她最近情绪很低，我想让她知道我在。",
        "tone": "亲密但不过度",
        "batch": 1,
        "sort_order": 1,
        "is_active": true
      },
      {
        "id": "b51107b0-05d9-4dac-82d3-bdf2e59db216",
        "relation": "恋人",
        "wish_type": "lonely",
        "content": "异地恋，我希望 ta 一个人吃饭的时候别觉得孤单。",
        "tone": "亲密但不过度",
        "batch": 1,
        "sort_order": 2,
        "is_active": true
      },
      {
        "id": "babf806f-9f6b-46b9-8cec-46cefbe1db45",
        "relation": "恋人",
        "wish_type": "sleep",
        "content": "他加班到十二点，希望他每天能睡够七小时。",
        "tone": "亲密但不过度",
        "batch": 1,
        "sort_order": 3,
        "is_active": true
      },
      {
        "id": "586aaa6a-33fe-4937-888b-08325521b9e4",
        "relation": "恋人",
        "wish_type": "body",
        "content": "她总说胃不疼，其实是每天都疼。",
        "tone": "亲密但不过度",
        "batch": 1,
        "sort_order": 4,
        "is_active": true
      },
      {
        "id": "c34f3a9b-fcd7-43a7-8719-ad458b737c7d",
        "relation": "恋人",
        "wish_type": "study",
        "content": "ta 想申请交换生，一直不敢投那份材料。",
        "tone": "亲密但不过度",
        "batch": 1,
        "sort_order": 5,
        "is_active": true
      },
      {
        "id": "9c502ed0-327e-463b-845f-b729e969867e",
        "relation": "恋人",
        "wish_type": "life",
        "content": "我们总点外卖，我想和 ta 一起做一顿饭。",
        "tone": "亲密但不过度",
        "batch": 1,
        "sort_order": 6,
        "is_active": true
      },
      {
        "id": "0b6cfacc-5465-426a-8cd2-d2880c2f567b",
        "relation": "老师",
        "wish_type": "body",
        "content": "老师一直站着讲课，希望他的嗓子能好一点。",
        "tone": "礼貌、有分寸",
        "batch": 1,
        "sort_order": 1,
        "is_active": true
      },
      {
        "id": "6446d27b-4fe9-4eba-8c82-b20c6efaa9e2",
        "relation": "老师",
        "wish_type": "emotion",
        "content": "老师说带完这届就休整一年，我希望他别硬撑。",
        "tone": "礼貌、有分寸",
        "batch": 1,
        "sort_order": 2,
        "is_active": true
      },
      {
        "id": "ead46601-3687-4932-8d5d-15d193d6d92c",
        "relation": "老师",
        "wish_type": "study",
        "content": "老师想带的课题缺人手，希望顺利批下来。",
        "tone": "礼貌、有分寸",
        "batch": 1,
        "sort_order": 3,
        "is_active": true
      },
      {
        "id": "c7950de6-f720-499b-8db2-737d52a7b82c",
        "relation": "老师",
        "wish_type": "life",
        "content": "老师办公桌的抽屉坏了两年，一直没换。",
        "tone": "礼貌、有分寸",
        "batch": 1,
        "sort_order": 4,
        "is_active": true
      },
      {
        "id": "61dec001-9dc8-4010-8cd0-3198eb6fe0e5",
        "relation": "老师",
        "wish_type": "lonely",
        "content": "老师帮了那么多人，好像没人帮他。",
        "tone": "礼貌、有分寸",
        "batch": 1,
        "sort_order": 5,
        "is_active": true
      },
      {
        "id": "66d24233-15b7-48e2-896a-2d13a4d70d5f",
        "relation": "老师",
        "wish_type": "sleep",
        "content": "老师批改作业到凌晨，希望他十一点能回家。",
        "tone": "礼貌、有分寸",
        "batch": 1,
        "sort_order": 6,
        "is_active": true
      },
      {
        "id": "fe760339-4546-4a80-85bc-3244f39b5614",
        "relation": "一个陌生人",
        "wish_type": "life",
        "content": "宿舍楼下修车的师傅，冬天手一直是裂的。",
        "tone": "克制、不冒犯",
        "batch": 1,
        "sort_order": 1,
        "is_active": true
      },
      {
        "id": "21331a69-14be-47f8-82e9-d28a735bf735",
        "relation": "一个陌生人",
        "wish_type": "body",
        "content": "食堂打饭的阿姨手腕总贴着膏药。",
        "tone": "克制、不冒犯",
        "batch": 1,
        "sort_order": 2,
        "is_active": true
      },
      {
        "id": "08724097-5d35-4bb8-881e-bed24eef8e8a",
        "relation": "一个陌生人",
        "wish_type": "lonely",
        "content": "每天一起等公交的那位老人，从没听他说过话。",
        "tone": "克制、不冒犯",
        "batch": 1,
        "sort_order": 3,
        "is_active": true
      },
      {
        "id": "2fb04414-bbac-434a-8dd9-f42426cb06b2",
        "relation": "一个陌生人",
        "wish_type": "emotion",
        "content": "图书馆对面那个总咬着指甲自习的人，希望他别那么焦虑。",
        "tone": "克制、不冒犯",
        "batch": 1,
        "sort_order": 4,
        "is_active": true
      },
      {
        "id": "1576f0b5-a75a-4eda-8ea8-4323f1b0496b",
        "relation": "一个陌生人",
        "wish_type": "sleep",
        "content": "夜班便利店店员，永远在最困的点上站着。",
        "tone": "克制、不冒犯",
        "batch": 1,
        "sort_order": 5,
        "is_active": true
      },
      {
        "id": "f0813c45-9696-431c-8526-4851e39e46fa",
        "relation": "一个陌生人",
        "wish_type": "study",
        "content": "地铁上那个背单词的女孩，希望能考上。",
        "tone": "克制、不冒犯",
        "batch": 1,
        "sort_order": 6,
        "is_active": true
      }
    ]
  },
  {
    "table": "task_templates",
    "expected": 120,
    "rows": [
      {
        "id": "ef47b25c-4ebc-4672-8e4e-1b964fe474f7",
        "wish_type": "body",
        "relation": null,
        "side": "for_ta",
        "text": "今晚十点给 TA 打电话，问今天走了多少步。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 1,
        "is_active": true
      },
      {
        "id": "6fd6ab70-8f27-4bfa-8d1a-e34ae2fa139d",
        "wish_type": "body",
        "relation": null,
        "side": "for_ta",
        "text": "提醒 TA 吃今天的药，等 TA 回复后说一句“别省”。",
        "proof_kind": "screenshot",
        "time_slot": "morning",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "健康"
        ],
        "weekend_only": false,
        "sort_order": 2,
        "is_active": true
      },
      {
        "id": "519b464b-f518-4588-8045-f6c85e239e78",
        "wish_type": "body",
        "relation": null,
        "side": "for_ta",
        "text": "陪 TA 视频时，让 TA 把疼的地方指给你看。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 3,
        "is_active": true
      },
      {
        "id": "77904fe9-1e4e-4faf-8865-aa18f828eeb4",
        "wish_type": "body",
        "relation": null,
        "side": "for_ta",
        "text": "帮 TA 查离 TA 最近的一次门诊时间，截图发过去。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "行动"
        ],
        "weekend_only": false,
        "sort_order": 4,
        "is_active": true
      },
      {
        "id": "fef0d7d2-366d-4d60-8e7d-8485ce7a874c",
        "wish_type": "body",
        "relation": null,
        "side": "for_ta",
        "text": "给 TA 寄一小包热敷贴，拍下快递单。",
        "proof_kind": "photo",
        "time_slot": "any",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "行动",
          "健康"
        ],
        "weekend_only": false,
        "sort_order": 5,
        "is_active": true
      },
      {
        "id": "e4b9242c-776c-4231-85c9-1503a69b0401",
        "wish_type": "body",
        "relation": null,
        "side": "for_ta",
        "text": "和 TA 约一次体检时间，截图聊天记录。",
        "proof_kind": "screenshot",
        "time_slot": "any",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "健康"
        ],
        "weekend_only": false,
        "sort_order": 6,
        "is_active": true
      },
      {
        "id": "3c88d198-d203-4381-8b83-a255b7a16156",
        "wish_type": "body",
        "relation": null,
        "side": "for_ta",
        "text": "今天陪 TA 走一段路，拍一张一起走过的路。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "陪伴",
          "健康"
        ],
        "weekend_only": false,
        "sort_order": 7,
        "is_active": true
      },
      {
        "id": "0eec6a53-4837-4bec-8150-e47c98f643d4",
        "wish_type": "body",
        "relation": "妈妈",
        "side": "for_ta",
        "text": "晚十点给妈妈打电话，问她今天走了多少步。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 8,
        "is_active": true
      },
      {
        "id": "10f44df4-48f9-40e7-8a63-eac82d5fb485",
        "wish_type": "body",
        "relation": "姥姥",
        "side": "for_ta",
        "text": "把今天的一张照片发给姥姥，配一句话。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "健康"
        ],
        "weekend_only": false,
        "sort_order": 9,
        "is_active": true
      },
      {
        "id": "e6fbe733-92e4-4687-8650-d3bdea7e05b5",
        "wish_type": "body",
        "relation": "爷爷",
        "side": "for_ta",
        "text": "教爷爷一个缓解膝盖疼的动作，拍下爷爷练习的样子。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "行动",
          "健康"
        ],
        "weekend_only": false,
        "sort_order": 10,
        "is_active": true
      },
      {
        "id": "6f8df692-3758-4c43-86ae-2191c0f2a4a1",
        "wish_type": "body",
        "relation": null,
        "side": "for_self",
        "text": "23:30 前放下手机，拍一张熄灯照。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "健康",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 11,
        "is_active": true
      },
      {
        "id": "981b80f5-fbfc-4813-8f3f-9c5ee657f374",
        "wish_type": "body",
        "relation": null,
        "side": "for_self",
        "text": "三餐按时，拍一张餐盘。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "健康",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 12,
        "is_active": true
      },
      {
        "id": "0fafa5d9-96df-4c78-852e-fcc0c929adb6",
        "wish_type": "body",
        "relation": null,
        "side": "for_self",
        "text": "今天走满 6000 步，截图步数。",
        "proof_kind": "screenshot",
        "time_slot": "any",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "健康",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 13,
        "is_active": true
      },
      {
        "id": "bb22ec06-1457-4bb4-8593-fa174ea5bb73",
        "wish_type": "body",
        "relation": null,
        "side": "for_self",
        "text": "给自己倒一杯温水，拍一张杯子。",
        "proof_kind": "photo",
        "time_slot": "any",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "健康",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 14,
        "is_active": true
      },
      {
        "id": "808047a0-b070-4a65-83f3-9114d888963b",
        "wish_type": "body",
        "relation": null,
        "side": "for_self",
        "text": "坐久了就起来拉伸一次，拍一张窗外的风景。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "健康",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 15,
        "is_active": true
      },
      {
        "id": "0ad37a94-13f2-4956-8ae7-c0e7c7548371",
        "wish_type": "body",
        "relation": null,
        "side": "for_self",
        "text": "把常吃的药按星期分好，拍一张分好的格子。",
        "proof_kind": "photo",
        "time_slot": "morning",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "健康",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 16,
        "is_active": true
      },
      {
        "id": "b22c05d5-e84c-491a-813b-080ad2c332c6",
        "wish_type": "body",
        "relation": null,
        "side": "for_self",
        "text": "今天做一次十分钟拉伸，拍一张垫子或地板。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "健康",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 17,
        "is_active": true
      },
      {
        "id": "f0bd8869-859d-4900-85cf-2ca4db6ae0d6",
        "wish_type": "body",
        "relation": null,
        "side": "for_self",
        "text": "把今天身体的不适写一行，没有就写“无”，拍下来。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "健康",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 18,
        "is_active": true
      },
      {
        "id": "a941ff76-18aa-4a42-88f8-c248f352271a",
        "wish_type": "body",
        "relation": null,
        "side": "money",
        "text": "本周奶茶不超过两杯，把省下的钱记下来。",
        "proof_kind": "screenshot",
        "time_slot": "any",
        "min_budget_cents": 500,
        "money_kind": "save",
        "tags": [
          "省钱",
          "生活"
        ],
        "weekend_only": true,
        "sort_order": 19,
        "is_active": true
      },
      {
        "id": "73ebbc79-6408-44af-800b-ba4525ba40d7",
        "wish_type": "body",
        "relation": null,
        "side": "money",
        "text": "周末陪 TA 去一趟药店，把比价省下的钱记下来。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 1000,
        "money_kind": "save",
        "tags": [
          "省钱",
          "行动"
        ],
        "weekend_only": true,
        "sort_order": 20,
        "is_active": true
      },
      {
        "id": "0f213f5b-d1b3-46c0-8a44-5a017fa8310c",
        "wish_type": "sleep",
        "relation": null,
        "side": "for_ta",
        "text": "十一点前给 TA 发一句晚安，截图发送记录。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "健康"
        ],
        "weekend_only": false,
        "sort_order": 1,
        "is_active": true
      },
      {
        "id": "1ba4cbba-a4c4-4431-8ba5-f41255071157",
        "wish_type": "sleep",
        "relation": null,
        "side": "for_ta",
        "text": "问 TA 昨天几点睡的，把 TA 说的数字记下来。",
        "proof_kind": "screenshot",
        "time_slot": "morning",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "健康"
        ],
        "weekend_only": false,
        "sort_order": 2,
        "is_active": true
      },
      {
        "id": "704a9a39-4c47-4aad-8b17-d2830481840e",
        "wish_type": "sleep",
        "relation": null,
        "side": "for_ta",
        "text": "和 TA 约定今晚同时熄灯，各自拍一张关灯后的房间。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "健康"
        ],
        "weekend_only": false,
        "sort_order": 3,
        "is_active": true
      },
      {
        "id": "e06ca93d-a454-44fd-8317-a8a08ea79644",
        "wish_type": "sleep",
        "relation": null,
        "side": "for_ta",
        "text": "给 TA 发一段白噪音，说“试试这个”。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "健康"
        ],
        "weekend_only": false,
        "sort_order": 4,
        "is_active": true
      },
      {
        "id": "9a8941ea-c90b-48c8-8384-a403dca7829b",
        "wish_type": "sleep",
        "relation": null,
        "side": "for_ta",
        "text": "先问问 TA 想不想把床头灯换成暖光。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "健康"
        ],
        "weekend_only": false,
        "sort_order": 5,
        "is_active": true
      },
      {
        "id": "f3068355-c47e-4554-85ad-93bd3aa36f43",
        "wish_type": "sleep",
        "relation": null,
        "side": "for_ta",
        "text": "陪 TA 打完一通睡前电话，截图通话时长。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 6,
        "is_active": true
      },
      {
        "id": "656d0b8c-9723-4455-8056-923d91885ef0",
        "wish_type": "sleep",
        "relation": null,
        "side": "for_ta",
        "text": "查一下 TA 那个城市的日落时间，发给 TA。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "行动"
        ],
        "weekend_only": false,
        "sort_order": 7,
        "is_active": true
      },
      {
        "id": "7a528949-eaea-4685-80c5-7b12974a6fe0",
        "wish_type": "sleep",
        "relation": null,
        "side": "for_ta",
        "text": "提醒 TA 睡前别喝浓茶，拍一张你自己的水杯。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "健康"
        ],
        "weekend_only": false,
        "sort_order": 8,
        "is_active": true
      },
      {
        "id": "584d2864-065f-49de-8fc3-f7096b4cbad5",
        "wish_type": "sleep",
        "relation": null,
        "side": "for_ta",
        "text": "给 TA 发三行字的睡前消息，截图发送记录。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "健康"
        ],
        "weekend_only": false,
        "sort_order": 9,
        "is_active": true
      },
      {
        "id": "0c00abed-6f9c-4a1f-828d-f938b060fd85",
        "wish_type": "sleep",
        "relation": null,
        "side": "for_ta",
        "text": "今晚不追问 TA 为什么不睡，只说“我在”。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "健康"
        ],
        "weekend_only": false,
        "sort_order": 10,
        "is_active": true
      },
      {
        "id": "a31577ee-a22f-4e1d-8df1-8300e1135900",
        "wish_type": "sleep",
        "relation": null,
        "side": "for_self",
        "text": "23:30 前放下手机，拍一张熄灯照。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "健康",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 11,
        "is_active": true
      },
      {
        "id": "802fddc8-11f6-4afd-89a2-fc68652c1805",
        "wish_type": "sleep",
        "relation": null,
        "side": "for_self",
        "text": "记录今天的入睡时间，截图备忘录。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "健康",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 12,
        "is_active": true
      },
      {
        "id": "b30ef65f-2680-4062-807c-811b3350f552",
        "wish_type": "sleep",
        "relation": null,
        "side": "for_self",
        "text": "睡前洗一次热水澡，拍一张浴室的暖灯。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "健康",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 13,
        "is_active": true
      },
      {
        "id": "8da1c52a-4f7d-4023-8657-34eb89ae369e",
        "wish_type": "sleep",
        "relation": null,
        "side": "for_self",
        "text": "把明早的闹钟定在固定时间，截图时钟。",
        "proof_kind": "screenshot",
        "time_slot": "any",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "健康",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 14,
        "is_active": true
      },
      {
        "id": "57e9ff70-b275-46f1-89e6-23ff88fd0f69",
        "wish_type": "sleep",
        "relation": null,
        "side": "for_self",
        "text": "十四点后不碰咖啡，拍一张今天喝的东西。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "健康",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 15,
        "is_active": true
      },
      {
        "id": "22f95378-8451-4a14-88c6-d15e753ec6e7",
        "wish_type": "sleep",
        "relation": null,
        "side": "for_self",
        "text": "关灯后做三件与屏幕无关的事，拍一张床头。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "健康",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 16,
        "is_active": true
      },
      {
        "id": "36aad84c-394c-4e4b-8a79-06d229e32086",
        "wish_type": "sleep",
        "relation": null,
        "side": "for_self",
        "text": "今晚把手机放到够不着的地方充电，拍一张充电的位置。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "健康",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 17,
        "is_active": true
      },
      {
        "id": "0e9a72fb-8b61-4409-809b-d40d317e6338",
        "wish_type": "sleep",
        "relation": null,
        "side": "for_self",
        "text": "午睡不超过三十分钟，截图闹钟。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "健康",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 18,
        "is_active": true
      },
      {
        "id": "5e9979a8-c915-444b-8484-7414d509eb0a",
        "wish_type": "sleep",
        "relation": null,
        "side": "money",
        "text": "帮 TA 挑一副耳塞或眼罩，把比价省下的钱记下来。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 1500,
        "money_kind": "save",
        "tags": [
          "省钱",
          "行动"
        ],
        "weekend_only": true,
        "sort_order": 19,
        "is_active": true
      },
      {
        "id": "7a790345-e6a1-40b5-80ef-40a353272b32",
        "wish_type": "sleep",
        "relation": null,
        "side": "money",
        "text": "本周少点一次夜宵外卖，省下的钱记进账本。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 1200,
        "money_kind": "save",
        "tags": [
          "省钱",
          "生活"
        ],
        "weekend_only": true,
        "sort_order": 20,
        "is_active": true
      },
      {
        "id": "5e970497-13ef-4737-8fe0-624d22b94d47",
        "wish_type": "lonely",
        "relation": null,
        "side": "for_ta",
        "text": "给 TA 打一通超过五分钟的电话，截图时长。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 1,
        "is_active": true
      },
      {
        "id": "1854d348-4b40-4d19-8ac4-be1cb81aa16f",
        "wish_type": "lonely",
        "relation": null,
        "side": "for_ta",
        "text": "把今天的晚饭拍给 TA，问 TA 吃了什么。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 2,
        "is_active": true
      },
      {
        "id": "5a892b00-e9d1-46e2-817c-7c46e61514cb",
        "wish_type": "lonely",
        "relation": null,
        "side": "for_ta",
        "text": "和 TA 分享一件今天发生的小事，截图对话。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 3,
        "is_active": true
      },
      {
        "id": "5b18adbc-2f10-4d65-8d63-0a14bf7a5f7a",
        "wish_type": "lonely",
        "relation": null,
        "side": "for_ta",
        "text": "陪 TA 云看同一部电影，截图播放进度。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 4,
        "is_active": true
      },
      {
        "id": "ceb7ef4e-ede6-4b74-84b8-1556073a9617",
        "wish_type": "lonely",
        "relation": null,
        "side": "for_ta",
        "text": "给 TA 发一张你小时候的照片。",
        "proof_kind": "photo",
        "time_slot": "any",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 5,
        "is_active": true
      },
      {
        "id": "988060e1-3d76-410c-8d3e-996298845aba",
        "wish_type": "lonely",
        "relation": null,
        "side": "for_ta",
        "text": "问 TA 今天有没有和谁说过话，如实记下。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 6,
        "is_active": true
      },
      {
        "id": "fc88c21d-6c6d-4a5d-8ce8-5f3a087c9338",
        "wish_type": "lonely",
        "relation": null,
        "side": "for_ta",
        "text": "在 TA 楼下陪 TA 走一圈，拍下路灯。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 7,
        "is_active": true
      },
      {
        "id": "6ad6b752-2a40-4693-853e-93827c828896",
        "wish_type": "lonely",
        "relation": null,
        "side": "for_ta",
        "text": "把 TA 介绍给你的一个朋友认识，截图群聊。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 8,
        "is_active": true
      },
      {
        "id": "f2853796-a32b-42d0-8f8c-b6d75b593131",
        "wish_type": "lonely",
        "relation": null,
        "side": "for_ta",
        "text": "给 TA 点一份水果，拍下 TA 收到的样子。",
        "proof_kind": "photo",
        "time_slot": "any",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 9,
        "is_active": true
      },
      {
        "id": "d7ef9045-5df3-4751-8bb3-7a39ec4e28d4",
        "wish_type": "lonely",
        "relation": "姥姥",
        "side": "for_ta",
        "text": "回家一趟，和姥姥吃一顿饭，拍一张饭桌。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 10,
        "is_active": true
      },
      {
        "id": "dfda1a71-6381-44dd-859d-6dc2ba0c3dc1",
        "wish_type": "lonely",
        "relation": null,
        "side": "for_self",
        "text": "今天主动约一个人一起吃饭，拍一张两个人的餐具。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "陪伴",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 11,
        "is_active": true
      },
      {
        "id": "8617e4ff-4f8e-4812-8404-9662746b6712",
        "wish_type": "lonely",
        "relation": null,
        "side": "for_self",
        "text": "和自己待三十分钟，不看手机，拍一张窗外的风景。",
        "proof_kind": "photo",
        "time_slot": "any",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "陪伴",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 12,
        "is_active": true
      },
      {
        "id": "580ff21b-871f-456a-82a9-e2eac3f9a474",
        "wish_type": "lonely",
        "relation": null,
        "side": "for_self",
        "text": "给一个很久没联系的人发一句问候。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 13,
        "is_active": true
      },
      {
        "id": "31308505-cabe-4c0e-8ae1-1c81d7645a6d",
        "wish_type": "lonely",
        "relation": null,
        "side": "for_self",
        "text": "记下一件让你觉得“有人在场”的事，拍一张写下的话。",
        "proof_kind": "photo",
        "time_slot": "any",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "陪伴",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 14,
        "is_active": true
      },
      {
        "id": "d10c5527-fe05-4a83-8247-11eabcddab7a",
        "wish_type": "lonely",
        "relation": null,
        "side": "for_self",
        "text": "去一个有人的地方自习两小时，拍一张桌面。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "陪伴",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 15,
        "is_active": true
      },
      {
        "id": "9a2bd5bd-7012-47fc-8697-3b66a3da7354",
        "wish_type": "lonely",
        "relation": null,
        "side": "for_self",
        "text": "对 TA 说出一次真实的想念。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 16,
        "is_active": true
      },
      {
        "id": "b4800324-42ab-49ef-82be-c260847fae15",
        "wish_type": "lonely",
        "relation": null,
        "side": "for_self",
        "text": "给家里打一通电话，只聊十分钟闲事，截图时长。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "陪伴",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 17,
        "is_active": true
      },
      {
        "id": "ea70725b-ffaf-4dae-89bd-a56a82555d92",
        "wish_type": "lonely",
        "relation": null,
        "side": "for_self",
        "text": "今天对一个人说一次“谢谢”，具体到那件事。",
        "proof_kind": "screenshot",
        "time_slot": "any",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 18,
        "is_active": true
      },
      {
        "id": "bd854655-4e45-4eb6-8822-1ecd158ce271",
        "wish_type": "lonely",
        "relation": null,
        "side": "money",
        "text": "周末做一次两小时线上答疑，填收入并附收款截图。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 4000,
        "money_kind": "earn",
        "tags": [
          "赚钱",
          "行动"
        ],
        "weekend_only": true,
        "sort_order": 19,
        "is_active": true
      },
      {
        "id": "3147e46f-ddb1-4c15-8208-47fff37de1cf",
        "wish_type": "lonely",
        "relation": null,
        "side": "money",
        "text": "本周自己做饭代替一次外卖，把省下的钱记进账本。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 2000,
        "money_kind": "save",
        "tags": [
          "省钱",
          "生活"
        ],
        "weekend_only": true,
        "sort_order": 20,
        "is_active": true
      },
      {
        "id": "17503813-58fd-4676-88b8-bf6ced77f5ec",
        "wish_type": "study",
        "relation": null,
        "side": "for_ta",
        "text": "陪 TA 自习一小时，拍一张你们各自的桌面。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "陪伴",
          "学业"
        ],
        "weekend_only": false,
        "sort_order": 1,
        "is_active": true
      },
      {
        "id": "c7ce646b-519e-4f5e-80bc-0fb9c2f2a237",
        "wish_type": "study",
        "relation": null,
        "side": "for_ta",
        "text": "给 TA 带一次饭，拍一张饭盒。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "行动",
          "学业"
        ],
        "weekend_only": false,
        "sort_order": 2,
        "is_active": true
      },
      {
        "id": "b03d55c5-ac4a-4703-8e79-47b572505420",
        "wish_type": "study",
        "relation": null,
        "side": "for_ta",
        "text": "听 TA 讲一遍今天卡住的那道题，记下 TA 的思路。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "学业"
        ],
        "weekend_only": false,
        "sort_order": 3,
        "is_active": true
      },
      {
        "id": "e0063313-640d-4512-8bf9-19b5122cde35",
        "wish_type": "study",
        "relation": null,
        "side": "for_ta",
        "text": "帮 TA 查一个院校或岗位的要求，截图发过去。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "行动"
        ],
        "weekend_only": false,
        "sort_order": 4,
        "is_active": true
      },
      {
        "id": "05e26ae6-1457-470d-8da5-8d16c6aac61b",
        "wish_type": "study",
        "relation": null,
        "side": "for_ta",
        "text": "提醒 TA 今天该完成的那一章，记下 TA 的回答。",
        "proof_kind": "screenshot",
        "time_slot": "morning",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "学业"
        ],
        "weekend_only": false,
        "sort_order": 5,
        "is_active": true
      },
      {
        "id": "afbd8c8c-409a-43bf-80be-1a3d3cb2456e",
        "wish_type": "study",
        "relation": null,
        "side": "for_ta",
        "text": "把 TA 的进度夸具体一点，截图发给 TA。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "学业"
        ],
        "weekend_only": false,
        "sort_order": 6,
        "is_active": true
      },
      {
        "id": "8293369b-c955-46d6-8df4-ba68ae5b0b72",
        "wish_type": "study",
        "relation": null,
        "side": "for_ta",
        "text": "帮 TA 订一个考试或投递的提醒。",
        "proof_kind": "screenshot",
        "time_slot": "morning",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "行动",
          "学业"
        ],
        "weekend_only": false,
        "sort_order": 7,
        "is_active": true
      },
      {
        "id": "f649840e-9649-41bb-8a29-77687dd7794b",
        "wish_type": "study",
        "relation": null,
        "side": "for_ta",
        "text": "整理一份 TA 缺的资料清单，发给 TA。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "行动"
        ],
        "weekend_only": false,
        "sort_order": 8,
        "is_active": true
      },
      {
        "id": "a70511a6-0a30-4602-8889-4a1700728df5",
        "wish_type": "study",
        "relation": null,
        "side": "for_ta",
        "text": "如果 TA 说累了，就回一句“那就明天”。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "学业"
        ],
        "weekend_only": false,
        "sort_order": 9,
        "is_active": true
      },
      {
        "id": "fb1a9a65-20eb-42de-88e7-d39fa1652b9f",
        "wish_type": "study",
        "relation": "老师",
        "side": "for_ta",
        "text": "给老师发一条感谢的消息，截图发送记录。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "学业"
        ],
        "weekend_only": false,
        "sort_order": 10,
        "is_active": true
      },
      {
        "id": "84fe180e-f162-4968-803d-b9730ca462f8",
        "wish_type": "study",
        "relation": null,
        "side": "for_self",
        "text": "今天先做最难的那件事，拍一张完成时的屏幕。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "学业",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 11,
        "is_active": true
      },
      {
        "id": "cbbdc6c8-f864-455a-8c96-80991ba7a472",
        "wish_type": "study",
        "relation": null,
        "side": "for_self",
        "text": "把手机放到另一个房间，学习四十分钟，拍一张书桌。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "学业",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 12,
        "is_active": true
      },
      {
        "id": "e45e4a32-ce26-4b2a-8e5f-1e01209f7d90",
        "wish_type": "study",
        "relation": null,
        "side": "for_self",
        "text": "写下今天真正推进的一件事，拍一张纸。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "学业",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 13,
        "is_active": true
      },
      {
        "id": "a1cbcdfd-4587-43fd-809b-917d7e44f431",
        "wish_type": "study",
        "relation": null,
        "side": "for_self",
        "text": "按时吃一顿正经饭，拍一张餐盘。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "学业",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 14,
        "is_active": true
      },
      {
        "id": "ab26a2a2-afba-4494-8ba6-90735a478262",
        "wish_type": "study",
        "relation": null,
        "side": "for_self",
        "text": "早睡半小时，截图屏幕使用时间。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "学业",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 15,
        "is_active": true
      },
      {
        "id": "246b10e1-136c-4836-87d5-3d7d837b2925",
        "wish_type": "study",
        "relation": null,
        "side": "for_self",
        "text": "起身走十分钟再回来，拍一张楼下的路。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "学业",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 16,
        "is_active": true
      },
      {
        "id": "6a08d6db-e7c3-477a-8097-bb0b2090fd81",
        "wish_type": "study",
        "relation": null,
        "side": "for_self",
        "text": "把明天要做的三件事写下来，拍一张清单。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "学业",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 17,
        "is_active": true
      },
      {
        "id": "26ed2d9b-ca1c-4c90-8be1-ba02c6384b18",
        "wish_type": "study",
        "relation": null,
        "side": "for_self",
        "text": "今天只集中看一次消息，其余时间静音，截图设置。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "学业",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 18,
        "is_active": true
      },
      {
        "id": "73bf37d2-9bd1-457b-83df-fad59c824c2e",
        "wish_type": "study",
        "relation": null,
        "side": "money",
        "text": "周末把旧的复习资料转卖，填收入并附收款截图。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 2000,
        "money_kind": "earn",
        "tags": [
          "赚钱",
          "生活"
        ],
        "weekend_only": true,
        "sort_order": 19,
        "is_active": true
      },
      {
        "id": "c7e2dd3f-900d-47bc-8c7a-e2b3bfbae8aa",
        "wish_type": "study",
        "relation": null,
        "side": "money",
        "text": "本周不买新的教辅，把省下的钱记进账本。",
        "proof_kind": "screenshot",
        "time_slot": "any",
        "min_budget_cents": 1500,
        "money_kind": "save",
        "tags": [
          "省钱",
          "生活"
        ],
        "weekend_only": true,
        "sort_order": 20,
        "is_active": true
      },
      {
        "id": "7ebebb12-ea2e-4140-80a3-a60f10af8999",
        "wish_type": "emotion",
        "relation": null,
        "side": "for_ta",
        "text": "听 TA 说十分钟，中间不插话，记下一句 TA 说的话。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "情绪"
        ],
        "weekend_only": false,
        "sort_order": 1,
        "is_active": true
      },
      {
        "id": "2dee8484-2054-4208-8e75-22998491afd4",
        "wish_type": "emotion",
        "relation": null,
        "side": "for_ta",
        "text": "陪 TA 走一圈，拍下路的尽头。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "陪伴",
          "情绪"
        ],
        "weekend_only": false,
        "sort_order": 2,
        "is_active": true
      },
      {
        "id": "2e35de8a-7022-4f9e-80e4-9089239e8144",
        "wish_type": "emotion",
        "relation": null,
        "side": "for_ta",
        "text": "问 TA“要不要我陪着”，不要问“你怎么了”。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 3,
        "is_active": true
      },
      {
        "id": "ccab1237-8c8e-41c4-807c-4ee378aa80ad",
        "wish_type": "emotion",
        "relation": null,
        "side": "for_ta",
        "text": "给 TA 发一件今天的小确幸，让 TA 笑一下。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "情绪"
        ],
        "weekend_only": false,
        "sort_order": 4,
        "is_active": true
      },
      {
        "id": "c7757abd-d0cf-4058-8821-018ed7e9d1f6",
        "wish_type": "emotion",
        "relation": null,
        "side": "for_ta",
        "text": "TA 说“没事”时，多发一句“我陪你一会儿”。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 5,
        "is_active": true
      },
      {
        "id": "9c0f983a-a3af-4d56-89ce-2431fe19175f",
        "wish_type": "emotion",
        "relation": null,
        "side": "for_ta",
        "text": "陪 TA 做一件不需要理由的事，拍一张照片。",
        "proof_kind": "photo",
        "time_slot": "any",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "陪伴",
          "行动"
        ],
        "weekend_only": false,
        "sort_order": 6,
        "is_active": true
      },
      {
        "id": "6c9053d0-46c3-461f-87ca-c3cfbee5d100",
        "wish_type": "emotion",
        "relation": null,
        "side": "for_ta",
        "text": "把 TA 说过的话复述一遍，确认自己听懂了。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "情绪"
        ],
        "weekend_only": false,
        "sort_order": 7,
        "is_active": true
      },
      {
        "id": "534cff95-09a5-48d3-8ddd-7d107565879c",
        "wish_type": "emotion",
        "relation": null,
        "side": "for_ta",
        "text": "把 TA 今天最在意的事记下来，明天先问这件事。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "情绪"
        ],
        "weekend_only": false,
        "sort_order": 8,
        "is_active": true
      },
      {
        "id": "52e6fdee-3f35-408b-8498-56d66dc1896d",
        "wish_type": "emotion",
        "relation": null,
        "side": "for_ta",
        "text": "给 TA 点一杯热的，备注写一句不留名。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "情绪"
        ],
        "weekend_only": false,
        "sort_order": 9,
        "is_active": true
      },
      {
        "id": "1db007f0-7e2b-459c-843d-27b8d7f7ca12",
        "wish_type": "emotion",
        "relation": "恋人",
        "side": "for_ta",
        "text": "和 TA 把一件拖着没聊的事聊开，记下开始和结束时间。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "情绪"
        ],
        "weekend_only": false,
        "sort_order": 10,
        "is_active": true
      },
      {
        "id": "46513b27-bde3-4c80-856b-d24bb0922416",
        "wish_type": "emotion",
        "relation": null,
        "side": "for_self",
        "text": "写下自己今天的情绪，只写一句。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "情绪",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 11,
        "is_active": true
      },
      {
        "id": "c98d9452-7240-4dd2-8a68-0c52f3470d3b",
        "wish_type": "emotion",
        "relation": null,
        "side": "for_self",
        "text": "今天不评价自己一次，把“我真差”换成一句事实写下来。",
        "proof_kind": "photo",
        "time_slot": "any",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "情绪",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 12,
        "is_active": true
      },
      {
        "id": "84a20acc-a3ca-42a8-83ad-491b2671a2df",
        "wish_type": "emotion",
        "relation": null,
        "side": "for_self",
        "text": "出去晒十分钟太阳，拍一张天空。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "情绪",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 13,
        "is_active": true
      },
      {
        "id": "f207518a-0a41-463c-8d5d-ff9dd38a7260",
        "wish_type": "emotion",
        "relation": null,
        "side": "for_self",
        "text": "联系一个能说话的人，截图对话。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "情绪",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 14,
        "is_active": true
      },
      {
        "id": "0d11431c-1a13-480d-87be-22524b14f1b4",
        "wish_type": "emotion",
        "relation": null,
        "side": "for_self",
        "text": "做一件只做五分钟的小事，拍一张结果。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "情绪",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 15,
        "is_active": true
      },
      {
        "id": "62982f26-5f50-44a8-810d-b286947c0241",
        "wish_type": "emotion",
        "relation": null,
        "side": "for_self",
        "text": "早点睡，拍一张关灯后的床头。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "情绪",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 16,
        "is_active": true
      },
      {
        "id": "8b9a4b20-792d-4f35-858e-e984806d6834",
        "wish_type": "emotion",
        "relation": null,
        "side": "for_self",
        "text": "今天允许自己休息十分钟，什么都不做，拍一张窗外。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "情绪",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 17,
        "is_active": true
      },
      {
        "id": "a763910d-0049-4675-8d41-a4d543b37e84",
        "wish_type": "emotion",
        "relation": null,
        "side": "for_self",
        "text": "把一句一直想说的话写下来，拍一张纸。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "情绪",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 18,
        "is_active": true
      },
      {
        "id": "c7279604-9bc6-40d5-8f2c-7035ec7891d7",
        "wish_type": "emotion",
        "relation": null,
        "side": "money",
        "text": "周末做一次两小时兼职，填收入并附工作截图。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 5000,
        "money_kind": "earn",
        "tags": [
          "赚钱",
          "行动"
        ],
        "weekend_only": true,
        "sort_order": 19,
        "is_active": true
      },
      {
        "id": "b2b58ae4-602c-4bf1-8ded-f72c351be0cd",
        "wish_type": "emotion",
        "relation": null,
        "side": "money",
        "text": "本周少买一件不必要的小东西，把省下的钱记进账本。",
        "proof_kind": "screenshot",
        "time_slot": "any",
        "min_budget_cents": 1500,
        "money_kind": "save",
        "tags": [
          "省钱",
          "生活"
        ],
        "weekend_only": true,
        "sort_order": 20,
        "is_active": true
      },
      {
        "id": "87c17b08-7d18-4f60-839b-2c5d3a4bfbff",
        "wish_type": "life",
        "relation": null,
        "side": "for_ta",
        "text": "帮 TA 查一个东西的价格，截图三个来源。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "行动",
          "生活"
        ],
        "weekend_only": false,
        "sort_order": 1,
        "is_active": true
      },
      {
        "id": "bdee767f-6e24-4f55-83e2-9889d392a5c5",
        "wish_type": "life",
        "relation": null,
        "side": "for_ta",
        "text": "提醒 TA 交那个费，记下 TA 说“交了”。",
        "proof_kind": "screenshot",
        "time_slot": "morning",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "生活"
        ],
        "weekend_only": false,
        "sort_order": 2,
        "is_active": true
      },
      {
        "id": "cc037e24-c725-4546-81f5-e3a087bf7618",
        "wish_type": "life",
        "relation": null,
        "side": "for_ta",
        "text": "替 TA 排一次队或跑一次腿，拍一张凭证。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "行动",
          "生活"
        ],
        "weekend_only": false,
        "sort_order": 3,
        "is_active": true
      },
      {
        "id": "f575496e-3a58-4ee9-8f14-da9c5b2a31df",
        "wish_type": "life",
        "relation": null,
        "side": "for_ta",
        "text": "把 TA 家里坏掉的那个东西的维修方式截图发给 TA。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "行动"
        ],
        "weekend_only": false,
        "sort_order": 4,
        "is_active": true
      },
      {
        "id": "10bf518e-7c66-4d1f-83d3-e3cf8d6eb08c",
        "wish_type": "life",
        "relation": null,
        "side": "for_ta",
        "text": "陪 TA 一起收拾一个抽屉，拍前后对比。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "陪伴",
          "生活"
        ],
        "weekend_only": false,
        "sort_order": 5,
        "is_active": true
      },
      {
        "id": "8f7417a6-9e0d-43db-8a71-cefbea00ed07",
        "wish_type": "life",
        "relation": null,
        "side": "for_ta",
        "text": "给 TA 做一次饭或点一顿靠谱的，拍一张饭菜。",
        "proof_kind": "photo",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "行动",
          "生活"
        ],
        "weekend_only": false,
        "sort_order": 6,
        "is_active": true
      },
      {
        "id": "fc48a60d-2103-430b-8e4e-8ce0b3e37fd8",
        "wish_type": "life",
        "relation": null,
        "side": "for_ta",
        "text": "查好 TA 明天要走的路线，截图发给 TA。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "沟通",
          "陪伴"
        ],
        "weekend_only": false,
        "sort_order": 7,
        "is_active": true
      },
      {
        "id": "1cd0cdc3-d086-42fd-8d23-18a3d9c96f2a",
        "wish_type": "life",
        "relation": null,
        "side": "for_ta",
        "text": "记下 TA 反复抱怨的那件小事，今天替 TA 做掉，拍一张做完的样子。",
        "proof_kind": "photo",
        "time_slot": "any",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "行动",
          "生活"
        ],
        "weekend_only": false,
        "sort_order": 8,
        "is_active": true
      },
      {
        "id": "143529c8-1d5a-451e-8f76-18434b34b0e1",
        "wish_type": "life",
        "relation": null,
        "side": "for_ta",
        "text": "陪 TA 采购一次，拍下购物袋。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "陪伴",
          "生活"
        ],
        "weekend_only": false,
        "sort_order": 9,
        "is_active": true
      },
      {
        "id": "e69255e7-a6bc-49cf-822f-05dca543427f",
        "wish_type": "life",
        "relation": null,
        "side": "for_ta",
        "text": "教 TA 用一个能省事的功能，截图操作步骤。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "心意",
          "行动",
          "生活"
        ],
        "weekend_only": false,
        "sort_order": 10,
        "is_active": true
      },
      {
        "id": "ba064a18-ab67-434a-8067-087f25623767",
        "wish_type": "life",
        "relation": null,
        "side": "for_self",
        "text": "把自己的桌面收拾干净，拍前后对比。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "生活",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 11,
        "is_active": true
      },
      {
        "id": "c5fea751-ca3f-43f9-8ff3-e4f075472a60",
        "wish_type": "life",
        "relation": null,
        "side": "for_self",
        "text": "今天按时吃三顿饭，拍下其中一顿。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "生活",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 12,
        "is_active": true
      },
      {
        "id": "346c82d4-7458-4aea-886e-43d110c3c9a9",
        "wish_type": "life",
        "relation": null,
        "side": "for_self",
        "text": "今天不熬夜，截图屏幕使用时间。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "生活",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 13,
        "is_active": true
      },
      {
        "id": "ee9fceca-b6d2-4e79-8fa7-13fa2b6f7ab9",
        "wish_type": "life",
        "relation": null,
        "side": "for_self",
        "text": "把一件拖了很久的琐事做完，拍一张结果。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "生活",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 14,
        "is_active": true
      },
      {
        "id": "e284953f-b98c-4c38-8591-879ce8284a6c",
        "wish_type": "life",
        "relation": null,
        "side": "for_self",
        "text": "给自己买一次水果，拍一张水果。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "生活",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 15,
        "is_active": true
      },
      {
        "id": "43ae3b65-2bbd-48ff-8985-dbbbb42c6487",
        "wish_type": "life",
        "relation": null,
        "side": "for_self",
        "text": "记一笔今天花了多少钱。",
        "proof_kind": "screenshot",
        "time_slot": "evening",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "生活",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 16,
        "is_active": true
      },
      {
        "id": "b54b552c-6b9d-488a-8be7-bb865a7bcd8a",
        "wish_type": "life",
        "relation": null,
        "side": "for_self",
        "text": "出门前把钥匙、校园卡、耳机清点一遍，拍一张摆好的物品。",
        "proof_kind": "photo",
        "time_slot": "morning",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "生活",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 17,
        "is_active": true
      },
      {
        "id": "cb7444b6-4985-4e45-8ddc-a2275788f9c6",
        "wish_type": "life",
        "relation": null,
        "side": "for_self",
        "text": "给自己十分钟，只整理一个角落，拍一张整理好的角落。",
        "proof_kind": "photo",
        "time_slot": "daytime",
        "min_budget_cents": 0,
        "money_kind": "",
        "tags": [
          "自理",
          "生活",
          "记录"
        ],
        "weekend_only": false,
        "sort_order": 18,
        "is_active": true
      },
      {
        "id": "acc77fca-1550-4e6b-8bed-2dd395c2728a",
        "wish_type": "life",
        "relation": null,
        "side": "money",
        "text": "本周奶茶不超过两杯，把省下的钱记下来。",
        "proof_kind": "screenshot",
        "time_slot": "any",
        "min_budget_cents": 1000,
        "money_kind": "save",
        "tags": [
          "省钱",
          "生活"
        ],
        "weekend_only": true,
        "sort_order": 19,
        "is_active": true
      },
      {
        "id": "71302abb-5d21-448e-8725-29f827ed0a95",
        "wish_type": "life",
        "relation": null,
        "side": "money",
        "text": "周末做两小时线上答疑，填收入并附收款截图。",
        "proof_kind": "screenshot",
        "time_slot": "daytime",
        "min_budget_cents": 4000,
        "money_kind": "earn",
        "tags": [
          "赚钱",
          "行动"
        ],
        "weekend_only": true,
        "sort_order": 20,
        "is_active": true
      }
    ]
  },
  {
    "table": "rewards",
    "expected": 24,
    "rows": [
      {
        "id": "7b27f4df-37d3-450d-821e-9b78314f09b9",
        "category": "health",
        "title": "护膝热敷仪",
        "note": "「妈妈的腿疼」这类愿望的默认兑现",
        "min_cents": 12000,
        "max_cents": 18000,
        "recommend_flags": [
          "body"
        ],
        "sort_order": 1,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "c8dbc924-3f30-49f6-8499-b74ec6ae929c",
        "category": "health",
        "title": "助眠枕",
        "note": "睡眠类愿望优先",
        "min_cents": 8000,
        "max_cents": 20000,
        "recommend_flags": [
          "sleep"
        ],
        "sort_order": 2,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "82caf5b7-3e33-41e2-8f1c-fb8844310933",
        "category": "health",
        "title": "艾草贴 / 泡脚包",
        "note": "差额不够时加的一件",
        "min_cents": 6000,
        "max_cents": 12000,
        "recommend_flags": [
          "body",
          "sleep"
        ],
        "sort_order": 3,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "76c98d8d-7d87-4693-8829-403dffc95564",
        "category": "health",
        "title": "电子血压计",
        "note": "需要 TA 自己会操作",
        "min_cents": 15000,
        "max_cents": 26000,
        "recommend_flags": [
          "body"
        ],
        "sort_order": 4,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "430336e6-3538-4ec9-8f1f-7462555f1233",
        "category": "health",
        "title": "按摩披肩",
        "note": "久坐、腰肩不适",
        "min_cents": 15000,
        "max_cents": 30000,
        "recommend_flags": [
          "body"
        ],
        "sort_order": 5,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "4bf9af7a-6e84-4b23-8d28-60f50e78c787",
        "category": "health",
        "title": "体检加项券",
        "note": "「陪 TA 体检」任务完成后才推荐",
        "min_cents": 20000,
        "max_cents": 40000,
        "recommend_flags": [
          "body"
        ],
        "sort_order": 6,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "459f4782-ce96-4f08-8f3b-5f6bed6006be",
        "category": "health",
        "title": "防滑拖鞋",
        "note": "独居长辈的低成本高安全",
        "min_cents": 5000,
        "max_cents": 9000,
        "recommend_flags": [
          "body",
          "life"
        ],
        "sort_order": 7,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "043482c2-3d42-4170-8390-c56d30c6c0d2",
        "category": "company",
        "title": "往返学校与家的车票",
        "note": "孤单类首选，价格随距离浮动大",
        "min_cents": 8000,
        "max_cents": 50000,
        "recommend_flags": [
          "lonely"
        ],
        "sort_order": 1,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "8740a845-235b-491b-8aaa-8c9bff9beac7",
        "category": "company",
        "title": "一次周末回家的饭钱",
        "note": "「这个周末，回去一趟」的由头",
        "min_cents": 10000,
        "max_cents": 20000,
        "recommend_flags": [
          "lonely",
          "emotion"
        ],
        "sort_order": 2,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "ea8d814a-1137-4377-8e19-52b9f0fef95c",
        "category": "company",
        "title": "两个人一起看的电影票",
        "note": "同城可用",
        "min_cents": 6000,
        "max_cents": 12000,
        "recommend_flags": [
          "lonely",
          "emotion"
        ],
        "sort_order": 3,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "65c5894c-a688-4aca-8549-c29e36f7f075",
        "category": "company",
        "title": "一通长途话费充值",
        "note": "异地最便宜的一件",
        "min_cents": 5000,
        "max_cents": 10000,
        "recommend_flags": [
          "lonely"
        ],
        "sort_order": 4,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "3c4f02c8-9d78-4e62-8214-d2177061bf62",
        "category": "company",
        "title": "陪诊半天的打车费",
        "note": "陪 TA 就医时匹配",
        "min_cents": 5000,
        "max_cents": 15000,
        "recommend_flags": [
          "body",
          "lonely"
        ],
        "sort_order": 5,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "0eb133c2-e9bb-4d93-80cf-b8fac73087df",
        "category": "company",
        "title": "一次短途同行的车票",
        "note": "超出目标价时的「加一档」",
        "min_cents": 15000,
        "max_cents": 40000,
        "recommend_flags": [
          "lonely"
        ],
        "sort_order": 6,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "88fe1004-3201-4c88-852f-dc330798969e",
        "category": "life",
        "title": "一双软底鞋",
        "note": "每天要走很多路的人",
        "min_cents": 15000,
        "max_cents": 30000,
        "recommend_flags": [
          "body",
          "life"
        ],
        "sort_order": 1,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "56c4490e-205f-4ff2-8114-0d37bd155cf3",
        "category": "life",
        "title": "护眼灯 / 老花镜",
        "note": "熬夜学习或看不清小字",
        "min_cents": 8000,
        "max_cents": 20000,
        "recommend_flags": [
          "sleep",
          "study",
          "life"
        ],
        "sort_order": 2,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "9fa56cf1-26d8-43c3-8ec5-ad0eb5442232",
        "category": "life",
        "title": "带滤网的保温杯",
        "note": "小额，适合补齐差额",
        "min_cents": 6000,
        "max_cents": 12000,
        "recommend_flags": [
          "life"
        ],
        "sort_order": 3,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "e74ccdd6-bff7-4da5-821f-09efdff811a3",
        "category": "life",
        "title": "一次家电维修或更换",
        "note": "对应「TA 家那个坏掉的东西」",
        "min_cents": 8000,
        "max_cents": 20000,
        "recommend_flags": [
          "life"
        ],
        "sort_order": 4,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "c32e23d0-680f-4e75-89be-2dc895c5256f",
        "category": "life",
        "title": "一周买菜基金",
        "note": "独居长辈或自己做饭的室友",
        "min_cents": 10000,
        "max_cents": 20000,
        "recommend_flags": [
          "life",
          "lonely"
        ],
        "sort_order": 5,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "55a22a77-2d69-4f56-8a22-8cc676d4414d",
        "category": "life",
        "title": "暖光小夜灯",
        "note": "夜里醒的人不用摸黑",
        "min_cents": 5000,
        "max_cents": 10000,
        "recommend_flags": [
          "sleep",
          "lonely"
        ],
        "sort_order": 6,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "8bb31c14-c69e-4cea-8475-57bdd57d07fd",
        "category": "heart",
        "title": "手写信 + 相册冲印",
        "note": "「再加一封信」的默认项",
        "min_cents": 4000,
        "max_cents": 9000,
        "recommend_flags": [
          "emotion",
          "lonely"
        ],
        "sort_order": 1,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "2d52d149-3149-49c0-825a-82a7b27563f0",
        "category": "heart",
        "title": "一顿火锅",
        "note": "情绪类愿望常见兑现",
        "min_cents": 10000,
        "max_cents": 20000,
        "recommend_flags": [
          "emotion",
          "study"
        ],
        "sort_order": 2,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "53b1e0cf-7790-4fc5-83c3-0be3537516f8",
        "category": "heart",
        "title": "一次线下的感谢（茶点）",
        "note": "给老师或帮过自己的人",
        "min_cents": 6000,
        "max_cents": 15000,
        "recommend_flags": [
          "study",
          "emotion"
        ],
        "sort_order": 3,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "be150a6b-afae-4f52-8b21-9648cd64b157",
        "category": "heart",
        "title": "一本 TA 提过的书",
        "note": "小额心意，容易凑够",
        "min_cents": 4000,
        "max_cents": 9000,
        "recommend_flags": [
          "study",
          "emotion"
        ],
        "sort_order": 4,
        "stock_left": null,
        "is_active": true,
        "version": 1
      },
      {
        "id": "eb703863-8500-483a-8c37-f25e55265342",
        "category": "heart",
        "title": "一张合影的放大打印",
        "note": "账本截图之外的第一份实物",
        "min_cents": 4000,
        "max_cents": 8000,
        "recommend_flags": [
          "emotion",
          "lonely"
        ],
        "sort_order": 5,
        "stock_left": null,
        "is_active": true,
        "version": 1
      }
    ]
  }
];
