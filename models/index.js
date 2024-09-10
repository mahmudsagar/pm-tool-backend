import { waterline, dbConfig } from '../db/connection.js';
import Attachment from './attachment.js';
import User from './user.js';
import Workspace from './workspace.js';
import PageMeta from './page_meta.js';
import Document from './document.js';
import Folder from './folder.js';
import Team from './team.js';
import CommentBody from './comment_body.js';
import CustomMeta from './custom_meta.js';
import CommentMeta from './comment_meta.js';

// Register models
waterline.registerModel(Attachment);
waterline.registerModel(User);
waterline.registerModel(Workspace);
waterline.registerModel(PageMeta);
waterline.registerModel(Document);
waterline.registerModel(Folder);
waterline.registerModel(Team);
waterline.registerModel(CommentMeta);
waterline.registerModel(CommentBody);
waterline.registerModel(CustomMeta);

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
            global.Attachment = ontology.collections.attachment;
            global.User = ontology.collections.user;
            global.Workspace = ontology.collections.workspace;
            global.PageMeta = ontology.collections.page_meta;
            global.Document = ontology.collections.document;
            global.Folder = ontology.collections.folder;
            global.Team = ontology.collections.team;
            global.CommentMeta = ontology.collections.comment_meta;
            global.CommentBody = ontology.collections.comment_body;
            global.CustomMeta = ontology.collections.custom_meta;
            resolve(ontology);
        });
    });
};

export default initializeWaterline;