import { waterline, dbConfig } from '../db/connection.js';
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

// Register models
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
            resolve(ontology);
        });
    });
};

export default initializeWaterline;