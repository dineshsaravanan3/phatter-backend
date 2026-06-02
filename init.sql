-- Use the platform database
CREATE DATABASE IF NOT EXISTS `dci_platform`;
USE `dci_platform`;

-- 1. Create users table
CREATE TABLE IF NOT EXISTS `users` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `avatar_url` VARCHAR(500) NULL,
    `role` ENUM('admin', 'member', 'viewer') NOT NULL DEFAULT 'member',
    `status` ENUM('online', 'away', 'offline') NOT NULL DEFAULT 'offline',
    `last_seen_at` DATETIME NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2. Create workspaces table
CREATE TABLE IF NOT EXISTS `workspaces` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,
    `logo_url` VARCHAR(500) NULL,
    `created_by` VARCHAR(36) NOT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE INDEX `workspaces_slug_key`(`slug`),
    PRIMARY KEY (`id`),
    CONSTRAINT `workspaces_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 3. Create channels table
CREATE TABLE IF NOT EXISTS `channels` (
    `id` VARCHAR(36) NOT NULL,
    `workspace_id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` TEXT NULL,
    `type` ENUM('public', 'private', 'dm', 'group') NOT NULL,
    `created_by` VARCHAR(36) NOT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    CONSTRAINT `channels_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `channels_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 4. Create channel_members table
CREATE TABLE IF NOT EXISTS `channel_members` (
    `id` VARCHAR(36) NOT NULL,
    `channel_id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `role` ENUM('admin', 'member') NOT NULL,
    `joined_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE INDEX `channel_members_channel_id_user_id_key`(`channel_id`, `user_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `channel_members_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `channels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `channel_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 5. Create messages table
CREATE TABLE IF NOT EXISTS `messages` (
    `id` VARCHAR(36) NOT NULL,
    `channel_id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `content` TEXT NOT NULL,
    `type` ENUM('text', 'file', 'task_ref', 'system') NOT NULL,
    `parent_id` VARCHAR(36) NULL,
    `is_pinned` BOOLEAN NOT NULL DEFAULT false,
    `edited_at` DATETIME NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    CONSTRAINT `messages_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `channels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `messages_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `messages_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `messages` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 6. Create message_reactions table
CREATE TABLE IF NOT EXISTS `message_reactions` (
    `id` VARCHAR(36) NOT NULL,
    `message_id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `emoji` VARCHAR(10) NOT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE INDEX `message_reactions_message_id_user_id_emoji_key`(`message_id`, `user_id`, `emoji`),
    PRIMARY KEY (`id`),
    CONSTRAINT `message_reactions_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `message_reactions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 7. Create files table
CREATE TABLE IF NOT EXISTS `files` (
    `id` VARCHAR(36) NOT NULL,
    `message_id` VARCHAR(36) NULL,
    `channel_id` VARCHAR(36) NOT NULL,
    `uploader_id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `s3_key` VARCHAR(500) NOT NULL,
    `cdn_url` VARCHAR(500) NOT NULL,
    `mime_type` VARCHAR(100) NOT NULL,
    `size_bytes` BIGINT NOT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    CONSTRAINT `files_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `files_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `channels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `files_uploader_id_fkey` FOREIGN KEY (`uploader_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 8. Create projects table
CREATE TABLE IF NOT EXISTS `projects` (
    `id` VARCHAR(36) NOT NULL,
    `workspace_id` VARCHAR(36) NOT NULL,
    `channel_id` VARCHAR(36) NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `color` VARCHAR(7) NOT NULL,
    `status` ENUM('active', 'archived') NOT NULL,
    `created_by` VARCHAR(36) NOT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    CONSTRAINT `projects_workspace_id_fkey` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `projects_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `channels` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `projects_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 9. Create tasks table
CREATE TABLE IF NOT EXISTS `tasks` (
    `id` VARCHAR(36) NOT NULL,
    `channel_id` VARCHAR(36) NOT NULL,
    `project_id` VARCHAR(36) NULL,
    `created_by` VARCHAR(36) NOT NULL,
    `assigned_to` VARCHAR(36) NULL,
    `title` VARCHAR(500) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('todo', 'in_progress', 'review', 'done') NOT NULL,
    `priority` ENUM('low', 'medium', 'high', 'urgent') NOT NULL,
    `due_date` DATE NULL,
    `position` INTEGER NOT NULL,
    `voice_transcript` TEXT NULL,
    `ai_suggested` BOOLEAN NOT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    CONSTRAINT `tasks_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `channels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `tasks_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `tasks_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `tasks_assigned_to_fkey` FOREIGN KEY (`assigned_to`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 10. Create task_comments table
CREATE TABLE IF NOT EXISTS `task_comments` (
    `id` VARCHAR(36) NOT NULL,
    `task_id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `content` TEXT NOT NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    CONSTRAINT `task_comments_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `task_comments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 11. Create notifications table
CREATE TABLE IF NOT EXISTS `notifications` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `type` ENUM('mention', 'task_assigned', 'task_due', 'message', 'reaction') NOT NULL,
    `ref_type` ENUM('message', 'task', 'channel') NOT NULL,
    `ref_id` VARCHAR(36) NOT NULL,
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
