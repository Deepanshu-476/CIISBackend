const multer =
require("multer");

const fs =
require("fs");

const storage =
multer.diskStorage({

    destination: (
        req,
        file,
        cb
    ) => {


        const dir =
        "uploads/chat";

        if (
            !fs.existsSync(dir)
        ) {

            fs.mkdirSync(
                dir,
                {
                    recursive: true
                }
            );
        }

        cb(
            null,
            dir
        );
    },

    filename: (
        req,
        file,
        cb
    ) => {

        cb(
            null,

            Date.now()
            + "-"
            + file.originalname
        );
    }
});

const upload =
multer({ storage });

module.exports = upload;