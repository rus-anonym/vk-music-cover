import {
    API, Upload, UploadSourceValue, VKError
} from "vk-io";
import { Interval, Timeout } from "@rus-anonym/scheduler";
import {
    createCanvas, loadImage, registerFont
} from "canvas";
import JIMP from "jimp";
import config from "./config";
import path from "path";
import moment from "moment";

let latestCover: string | null = null;
let isGenerate = false;
let rateLimitMultiplier = 0;

registerFont(path.resolve(__dirname, "../assets/heavy.ttf"), { family: "Heavy", });
registerFont(path.resolve(__dirname, "../assets/light.ttf"), { family: "Light", });

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

let watcherId = 0;
const watcher = (): API => {
    watcherId = watcherId === config.watchers.length ? 1 : watcherId + 1;
    return new API({
        apiVersion: "5.160",
        token: config.watchers[watcherId - 1]
    });
};

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

const removeCover = async (): Promise<boolean> => {
    if (latestCover !== null) {
        await api.call("photos.removeOwnerCoverPhoto", { group_id: config.groupId, });
        latestCover = null;
        return true;
    }
    return false;
};

const generateCover = async ({
    artists,
    title,
    thumb,
    subtitle
}: {
    artist: string;
    title: string;
    subtitle?: string;
    thumb: string | null;
    artists: {name: string; photo?: string}[];
}): Promise<Buffer> => {
    const [coverWidth, coverHeight] = [1590, 530];
    const [thumbWidth, thumbHeight, thumbBackgroundBlur] = [350, 350, 12];

    const thumbImage = await JIMP.read(thumb ? thumb : path.resolve(__dirname, "../assets/defaultThumb.png"));
    const background = thumb ? thumbImage.clone() : new JIMP(coverWidth, coverHeight, "#222222");

    if (thumb) {
        background.cover(coverWidth, coverHeight);
        background.blur(thumbBackgroundBlur);
        background.brightness(-0.5);
    }

    thumbImage.resize(thumbWidth, thumbHeight);

    background.blit(thumbImage, coverWidth / 5 - thumbWidth / 2, 100);

    const buffer = await background.getBufferAsync(JIMP.MIME_PNG);

    const canvas = createCanvas(coverWidth, coverHeight);
    const ctx = canvas.getContext("2d");
    const canvasCover = await loadImage(buffer);
    ctx.drawImage(canvasCover, 0, 0, coverWidth, coverHeight);

    ctx.font = "56px Heavy";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";

    const calculatedSize = ((coverWidth - (coverWidth / 5 + thumbWidth / 2 + 50)) / ctx.measureText(title).width) * 56;
    const fontSize = calculatedSize > 56 ? 56 : calculatedSize;
    ctx.font = `${Math.floor(fontSize)}px Heavy`;
    ctx.fillText(
        title,
        coverWidth / 5 + thumbWidth / 2 + 50,
        150
    );

    if (subtitle) {
        ctx.font = "36px Regular";
        ctx.fillStyle = "#b0b0b0";
        ctx.textAlign = "left";
        ctx.fillText(
            subtitle,
            coverWidth / 5 + thumbWidth / 2 + 50,
            190
        );
    }

    artists.sort(x => x.photo === undefined ? 1 : -1);

    for (let i = 0; i < artists.length; ++i) {
        const artist = artists[i];
        const hasPhoto = artist.photo !== undefined;
        const [x, y] = [
            coverWidth / 5 + thumbWidth / 2 + 50,
            (subtitle ? 210 : 190) + i * 75
        ];

        if (hasPhoto) {
            const artistImage = await loadImage(artist.photo as string);
            const [width, height, radius] = [
                64,
                64,
                7
            ];

            ctx.save();

            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + width - radius, y);
            ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
            ctx.lineTo(x + width, y + height - radius);
            ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
            ctx.lineTo(x + radius, y + height);
            ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
            ctx.closePath();

            ctx.clip();

            ctx.drawImage(
                artistImage,
                x,
                y,
                width,
                height
            );

            ctx.restore();
        }

        ctx.font = "48px Regular";
        ctx.fillStyle = "#fff";
        ctx.textAlign = "left";
        ctx.fillText(
            artist.name,
            hasPhoto ? x + 75 : x,
            y + 48
        );
    }

    ctx.font = "36px Regular";
    ctx.fillStyle = "#b0b0b0";
    ctx.textAlign = "center";
    ctx.fillText(
        moment().format("DD.MM.YYYY, HH:mm"),
        coverWidth / 5,
        coverHeight - 30
    );

    return canvas.toBuffer();
};

const loadArtistsInfo = async (
    artists: string[]
): Promise<
    {
        name: string;
        photo?: string;
    }[]
> => {
    const response: {
        name: string;
        photo?: string;
    }[] = [];

    for (const q of artists) {
        const artists = (
            (await api.call("audio.searchArtists", { q })) as unknown as {
                items: {
                    name: string;
                    photo?: {url: string}[];
                }[];
            }
        ).items;
        const artist = artists.find((x) => x.photo !== undefined);
        if (artist && artist.photo && artist.photo.length > 0) {
            response.push({
                name: artist.name,
                photo: artist.photo[0].url,
            });
        } else {
            response.push({ name: q });
        }
    }

    return response;
};

const updateCover = async (): Promise<boolean> => {
    const response = (await watcher().groups.getById({
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
                main_artists?: { name: string; id: string }[];
            };
        }[];
    };

    const [status] = response.groups;

    if (!status?.status_audio) {
        isGenerate = false;
        return await removeCover();
    }

    const {
        artist,
        title,
        subtitle,
        album,
        main_artists: artists,
    } = status.status_audio;

    const thumb = album?.thumb ? Object.values(album.thumb)[
        Object.values(album.thumb).length - 1
    ] : null;

    const id = `${artist} - ${title}:${moment().format("DD.MM.YYYY, HH:mm")}`;

    if (latestCover === id || isGenerate) {
        return false;
    }
    isGenerate = true;
    await removeCover();

    try {
        const cover = await generateCover({
            artist,
            thumb,
            title,
            subtitle,
            artists: artists ? await loadArtistsInfo(artists.map((artist) => artist.name)) : [{ name: artist }],
        });

        if (isGenerate) {
            await uploadCover(cover);
            latestCover = id;
        }
    } catch (error) {
        //
    }
    isGenerate = false;

    return true;
};

const task = new Interval({
    intervalTimer: Math.floor(config.watchers.length * 5000 / 24 / 60) * 1000,
    source: updateCover,
    onDone: (res, meta): void => {
        if (res === true) {
            console.log(
                "Update cover",
                new Date(),
                `per ${meta.executionTime.toFixed(2)}ms`
            );
        }
        rateLimitMultiplier = 0;
    },
    onError: (err): void => {
        if (err instanceof VKError && err.code === 29) {
            rateLimitMultiplier++;
            task.pause();
            new Timeout(task.unpause.bind(task), 30000 * rateLimitMultiplier);
            console.log(new Date(), `RateLimit: paused ${30 * rateLimitMultiplier}sec`);
        } else {
            console.error("Error on cover update", new Date(), err);
        }
        void removeCover();
    },
});

void removeCover().then(() => {
    console.log("Started at", new Date());
    console.log(`Update every ${Math.floor(config.watchers.length * 5000 / 24 / 60)}s`);
});

