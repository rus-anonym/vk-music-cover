import {
    API, Upload, UploadSourceValue
} from "vk-io";
import { Interval } from "@rus-anonym/scheduler";
import {
    createCanvas, loadImage, registerFont
} from "canvas";
import JIMP from "jimp";
import config from "./config";
import path from "path";

let latestCover = "default";

const api = new API({
    apiVersion: "5.160",
    apiHeaders: {
        "X-Get-Processing-Time": "1",
        "X-Fork-Disabled": "1",
        "User-Agent":
            "VKAndroidApp/6.53-9200 (Android 11.0; SDK 30; x64; Huawei; ru)",
        "X-VK-Android-Client": "new",
    },
    token: config.token,
});
const upload = new Upload({ api });

const uploadCover = (
    value: UploadSourceValue
): Promise<{
    images: {
        url: string;
        width: number;
        height: number;
    }[];
}> => {
    return upload.groupCover({
        group_id: config.groupId,
        source: { value },
        crop_x: "" as unknown as number,
        crop_x2: 1590,
        crop_y: "" as unknown as number,
        crop_y2: 920,
    });
};

const resetCover = async (): Promise<boolean> => {
    if (latestCover !== "default") {
        await uploadCover(path.resolve(__dirname, "../assets/defaultCover.jpg"));
        latestCover = "default";
        return true;
    }
    return false;
};

const generateCover = async ({
    artist,
    title,
    thumb,
}: {
    artist: string;
    title: string;
    subtitle?: string;
    thumb: string;
    album?: string;
}): Promise<Buffer> => {
    const [coverWidth, coverHeight] = [1590, 920];
    const [thumbWidth, thumbHeight, thumbBackgroundBlur] = [350, 350, 3];

    const thumbImage = await JIMP.read(thumb);
    const backgroundThumbImage = thumbImage.clone();
    backgroundThumbImage.gaussian(thumbBackgroundBlur);
    thumbImage.resize(thumbWidth, thumbHeight);
    const image = new JIMP(coverWidth, coverHeight);

    backgroundThumbImage.cover(coverWidth, coverHeight);
    image.composite(backgroundThumbImage, 0, 0);
    image.composite(thumbImage, coverWidth / 2 - thumbWidth / 2, 100);

    const buffer = await image.getBufferAsync(JIMP.MIME_PNG);

    registerFont(path.resolve(__dirname, "../assets/font.ttf"), { family: "VK" });
    const canvas = createCanvas(coverWidth, coverHeight);
    const ctx = canvas.getContext("2d");
    const canvasCover = await loadImage(buffer);
    ctx.drawImage(canvasCover, 0, 0, coverWidth, coverHeight);

    ctx.font = "48px VK";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(
        `${title} - ${artist}`,
        coverWidth / 2,
        100 + thumbHeight + 50
    );

    return canvas.toBuffer();
};

const updateCover = async (): Promise<boolean> => {
    const response = (await api.groups.getById({
        group_id: config.groupId,
        fields: ["status"],
    })) as unknown as {
        groups: {
            status_audio?: {
                artist: string;
                title: string;
                duration: number;
                subtitle?: string;
                album?: {
                    title?: string;
                    thumb?: {
                        photo_34?: string;
                        photo_68?: string;
                        photo_135?: string;
                        photo_270?: string;
                        photo_300?: string;
                        photo_600?: string;
                        photo_1200?: string;
                    };
                };
            };
        }[];
    };

    const [status] = response.groups;

    if (!status?.status_audio?.album) {
        return await resetCover();
    }

    const {
        artist, title, subtitle, album
    } = status.status_audio;

    if (!album.thumb) {
        return await resetCover();
    }

    const thumb = Object.values(album.thumb)[
        Object.values(album.thumb).length - 1
    ];

    const id = `${artist} - ${title}`;

    if (latestCover === id) {
        return false;
    }
    latestCover = id;

    const cover = await generateCover({
        album: album.title,
        artist,
        thumb,
        title,
        subtitle,
    });

    await uploadCover(cover);

    return true;
};

new Interval({
    intervalTimer: 5000,
    source: updateCover,
    onDone: (res): void => {
        if (res === true) {
            console.log("Update cover", new Date());
        }
    },
    onError: (err): void => {
        console.error("Error on cover update", new Date(), err );
    }
});
