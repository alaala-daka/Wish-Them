-- 迁移 0008｜任务标签、金钱口径与打卡金额
-- 标签与金额口径都允许为空：旧任务/旧打卡没有这些字段时由代码确定性兜底，
-- 平台迁移子集又要求 ADD COLUMN 不能带 DEFAULT/NOT NULL，因此这里只加可空列。

-- 任务模板：标签数组（jsonb）与省钱/赚钱口径（save / earn）
ALTER TABLE app.task_templates ADD COLUMN tags jsonb;
ALTER TABLE app.task_templates ADD COLUMN money_kind text;

-- 任务实例：签署时从模板复制，旧任务为空时由 toTaskDto 兜底
ALTER TABLE app.tasks ADD COLUMN tags jsonb;
ALTER TABLE app.tasks ADD COLUMN money_kind text;

-- 打卡：金钱任务完成时用户自填的实际金额（分）与口径（saved / earned）
-- 非金钱任务保持 NULL；旧打卡不受影响。
ALTER TABLE app.checkins ADD COLUMN amount_cents integer;
ALTER TABLE app.checkins ADD COLUMN amount_kind text;
