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

// Native compound indexes Waterline cannot express (best effort, idempotent).
const ensureIndexes = async () => {
    const db = dbConfig.adapters.mongo.datastores?.default?.manager;
    if (!db || typeof db.collection !== 'function') return;
    await db.collection('favorite').createIndex({ user_id: 1, entity_type: 1, entity_id: 1 }, { unique: true });
    await db.collection('favorite').createIndex({ user_id: 1, workspace_id: 1, created_at: -1 });
    await db.collection('recent_item').createIndex({ user_id: 1, entity_type: 1, entity_id: 1 }, { unique: true });
    await db.collection('recent_item').createIndex({ user_id: 1, workspace_id: 1, viewed_at: -1 });
    await db.collection('trash_item').createIndex({ workspace_id: 1, deleted_at: -1 });
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
            ensureIndexes().catch((indexErr) => console.error('Failed to ensure indexes:', indexErr.message));
            resolve(ontology);
        });
    });
};

export default initializeWaterline;