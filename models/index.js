import Waterline from 'waterline';
import { waterline, dbConfig } from '../db/connection.js';
import Workspace from './workspace.js';
import Sheet from './sheet.js';
import Page from './page.js';
import Whiteboard from './whitesboard.js';
import Document from './document.js';
import Folder from './folder.js';
import Team from './team.js';
import Comment from './comment.js';
import CommentBody from './comment_body.js';
import CustomMetaAttributes from './custom_meta_attributes.js';

// Register models
waterline.registerModel(Workspace);
waterline.registerModel(Sheet);
waterline.registerModel(Page);
waterline.registerModel(Whiteboard);
waterline.registerModel(Document);
waterline.registerModel(Folder);
waterline.registerModel(Team);
waterline.registerModel(Comment);
waterline.registerModel(CommentBody);
waterline.registerModel(CustomMetaAttributes);

// Register other models as needed
const initializeWaterline = async () => {
    return new Promise((resolve, reject) => {
        waterline.initialize(dbConfig, (err, ontology) => {
            if (err) {
                return reject(err);
            }
            resolve(ontology);
        });
    });
};

export default initializeWaterline;