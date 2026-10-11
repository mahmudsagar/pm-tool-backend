import { waterline, dbConfig } from '../db/connection.js';
import Auth from './auth.js';
import Attachment from './attachment.js';
import User from './user.js';
import Space from './space.js';
import Group from './group.js';
import PageMeta from './page_meta.js';
import PageContent from './page_content.js';
import Folder from './folder.js';
import Team from './team.js';
import CustomMeta from './custom_meta.js';
import CommentMeta from './comment_meta.js';
import CommentContent from './comment_content.js';
import Media from './media.js';
import Board from './board.js';
import Workspace from './workspace.js';
import PageHistory from './page_history.js';
import Notification from './notification.js';
import TestCoverageSnapshot from './test_coverage_snapshot.js';
import HealthVisibility from './health_visibility.js';
import Conversation from './conversation.js';
import Message from './message.js';
import Favorite from './favorite.js';
import RecentItem from './recent_item.js';
import TrashItem from './trash_item.js';
import Invitation from './invitation.js';
import TaskEvent from './task_event.js';
import Sprint from './sprint.js';
import AuditLog from './audit_log.js';

// Register models
waterline.registerModel(Auth);
waterline.registerModel(Attachment);
waterline.registerModel(User);
waterline.registerModel(Space);
waterline.registerModel(Group);
waterline.registerModel(PageMeta);
waterline.registerModel(PageContent);
waterline.registerModel(Folder);
waterline.registerModel(Team);
waterline.registerModel(CommentMeta);
waterline.registerModel(CommentContent);
waterline.registerModel(CustomMeta);
waterline.registerModel(Media);
waterline.registerModel(Board);
waterline.registerModel(Workspace);
waterline.registerModel(PageHistory);
waterline.registerModel(Notification);
waterline.registerModel(TestCoverageSnapshot);
waterline.registerModel(HealthVisibility);
waterline.registerModel(Conversation);
waterline.registerModel(Message);
waterline.registerModel(Favorite);
waterline.registerModel(RecentItem);
waterline.registerModel(TrashItem);
waterline.registerModel(Invitation);
waterline.registerModel(TaskEvent);
waterline.registerModel(Sprint);
waterline.registerModel(AuditLog);

// Native compound indexes Waterline cannot express (best effort, idempotent).
const ensureIndexes = async () => {
    const db = dbConfig.adapters.mongo.datastores?.default?.manager;
    if (!db || typeof db.collection !== 'function') return;
    await db.collection('favorite').createIndex({ user_id: 1, entity_type: 1, entity_id: 1 }, { unique: true });
    await db.collection('favorite').createIndex({ user_id: 1, workspace_id: 1, created_at: -1 });
    await db.collection('recent_item').createIndex({ user_id: 1, entity_type: 1, entity_id: 1 }, { unique: true });
    await db.collection('recent_item').createIndex({ user_id: 1, workspace_id: 1, viewed_at: -1 });
    await db.collection('trash_item').createIndex({ workspace_id: 1, deleted_at: -1 });
    // Unique only when set: Waterline stores '' for unset string attributes.
    await db.collection('user').createIndex({ handle: 1 }, { unique: true, partialFilterExpression: { handle: { $gt: '' } } });
    await db.collection('workspace').createIndex({ slug: 1 }, { unique: true, partialFilterExpression: { slug: { $gt: '' } } });
    await db.collection('invitation').createIndex({ token: 1 }, { unique: true });
    await db.collection('invitation').createIndex({ email: 1, status: 1 });
    await db.collection('invitation').createIndex({ workspace_id: 1, status: 1 });
    await db.collection('task_event').createIndex({ board_id: 1, at: 1 });
    await db.collection('task_event').createIndex({ task_id: 1, at: 1 });
    await db.collection('sprint').createIndex({ board_id: 1, start_date: 1, createdAt: 1 });
    await db.collection('message').createIndex({ conversation_id: 1, parent_message_id: 1, createdAt: -1 });
    await db.collection('message').createIndex({ parent_message_id: 1, createdAt: 1 });
    await db.collection('audit_log').createIndex({ workspace_id: 1, createdAt: -1, _id: -1 });
    await db.collection('audit_log').createIndex({ workspace_id: 1, action: 1 });
};

// Register other models as needed
const initializeWaterline = async () => {
    return new Promise((resolve, reject) => {
        waterline.initialize(dbConfig, (err, ontology) => {
            if (err) {
                console.error('Failed to initialize ORM:', err);
                return reject(err);
            }
            console.log('ORM initialized');
            // Make models globally accessible
            global.Auth = ontology.collections.auth;
            global.Attachment = ontology.collections.attachment;
            global.User = ontology.collections.user;
            global.Space = ontology.collections.space;
            global.Group = ontology.collections.group;
            global.PageMeta = ontology.collections.page_meta;
            global.PageContent = ontology.collections.page_content;
            global.Folder = ontology.collections.folder;
            global.Team = ontology.collections.team;
            global.CommentMeta = ontology.collections.comment_meta;
            global.CommentContent = ontology.collections.comment_content;
            global.CustomMeta = ontology.collections.custom_meta;
            global.Media = ontology.collections.media;
            global.Board = ontology.collections.board;
            global.Workspace = ontology.collections.workspace;
            global.PageHistory = ontology.collections.page_history;
            global.Notification = ontology.collections.notification;
            global.TestCoverageSnapshot = ontology.collections.test_coverage_snapshot;
            global.HealthVisibility = ontology.collections.health_visibility;
            global.Conversation = ontology.collections.conversation;
            global.Message = ontology.collections.message;
            global.Favorite = ontology.collections.favorite;
            global.RecentItem = ontology.collections.recent_item;
            global.TrashItem = ontology.collections.trash_item;
            global.Invitation = ontology.collections.invitation;
            global.TaskEvent = ontology.collections.task_event;
            global.Sprint = ontology.collections.sprint;
            global.AuditLog = ontology.collections.audit_log;
            ensureIndexes().catch((indexErr) => console.error('Failed to ensure indexes:', indexErr.message));
            resolve(ontology);
        });
    });
};

export default initializeWaterline;