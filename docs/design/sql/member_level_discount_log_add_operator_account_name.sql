-- member_level_discount_log 增加操作人登录账号名，供 A19 折扣修改历史展示
ALTER TABLE `member_level_discount_log`
    ADD COLUMN `operator_account_name` varchar(64) NULL DEFAULT NULL COMMENT '操作人登录账号名' AFTER `operator_name`;
