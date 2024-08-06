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
import MongoTest from './test.js';

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
waterline.registerModel(MongoTest);

// Register other models as needed
const initializeWaterline = async () => {
    return new Promise((resolve, reject) => {
        waterline.initialize(dbConfig, (err, ontology) => {
            if (err) {
                console.error('Failed to initialize ORM:', err);
                return reject(err);
            }
            console.log('ORM initialized:');
            // Make models globally accessible
            global.Workspace = ontology.collections.workspace;
            global.Sheet = ontology.collections.sheet;
            global.Page = ontology.collections.page;
            global.Whiteboard = ontology.collections.whiteboard;
            global.Document = ontology.collections.document;
            global.Folder = ontology.collections.folder;
            global.Team = ontology.collections.team;
            global.MongoTest = ontology.collections.mongoTest;
            global.Comment = ontology.collections.comment;
            global.CommentBody = ontology.collections.comment_body;
            global.CustomMetaAttributes = ontology.collections.custom_meta_attributes;
            resolve(ontology);
        });
    });
};

export default initializeWaterline;