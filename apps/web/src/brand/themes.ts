import type { CSSProperties } from 'react';
import type { ThemeId } from '../shared/appearance';
import assets from './assets.json' with { type: 'json' };

type Theme = {
  number: string;
  name: string;
  english: string;
  description: string;
  designStyle: string;
  designSlogan: string;
  paletteNames: [string, string, string, string, string];
  heading: string[];
  introduction: string;
  note: string;
  imageAlt: string;
  palette: [string, string, string, string, string];
};

export function themeCoverFrameSrc(id: ThemeId): string {
  return `/brand/frames/${id}.svg`;
}

export function themeFaviconSrc(id: ThemeId): string {
  return `/brand/favicons/${id}.svg`;
}

export function themeChromeColor(id: ThemeId, pathname: string, preview = false): string {
  const darkHeader = pathname === '/' && (id === 'stillwood' || id === 'window-seat');
  return themes[id].palette[preview || darkHeader ? 1 : 0];
}

export const themes: Record<ThemeId, Theme> = {
  grove: {
    number: '01',
    name: '林间电台',
    english: 'THE GROVE',
    description:
      '收录现站的森林主视觉、草绿字标与温和圆角。把已经熟悉的 his.fm 放在这里，作为三套新提案的比较起点。',
    designStyle: '当前设计',
    designSlogan: '世界很快。你可以，慢慢来。',
    paletteNames: ['Paper', 'Forest', 'Lime', 'Grass', 'Lilac'],
    heading: ['世界很快。', '你可以，', '慢慢来。'],
    introduction: '聊 AI，聊工作。\n也聊屏幕之外，正在发生的生活。',
    note: '一段树荫，一点陪伴。',
    imageAlt: '巨树的树荫下，一个人坐在草地上，望向阳光中的未来城市',
    palette: ['#F3F3EC', '#213E2D', '#D0F66D', '#759C45', '#DFD8F0'],
  },
  interval: {
    number: '02',
    name: '间隙',
    english: 'OPEN INTERVAL',
    description:
      '把暂停写成一对打开的括号。酸青绿、近黑色、极大的字与极细的线；真实皮肤与日常物件，出现在精确的秩序里。',
    designStyle: '编辑实验',
    designSlogan: '给日常，留一道间隙。',
    paletteNames: ['Paper', 'Ink', 'Acid grass', 'Cobalt', 'Concrete'],
    heading: ['今天就', '到这里。'],
    introduction: '关于工作、睡眠，\n和屏幕外的小事。',
    note: '关掉一个窗口。留下一点空白。',
    imageAlt: '椅边一只松弛的手，身旁伸出一片青草叶',
    palette: ['#F5F4EE', '#1C211A', '#D6F25B', '#294ADF', '#D6D8CE'],
  },
  'soft-landing': {
    number: '03',
    name: '软着陆',
    english: 'SOFT LANDING',
    description:
      '让玻璃承接棉麻，让重量轻轻落地。淡紫、青草与奶油黄铺开；衬线字标、柔软回环和不对称的圆弧，共同留下触觉。',
    designStyle: '感官雕塑',
    designSlogan: '生活有柔软的边。',
    paletteNames: ['Butter', 'Aubergine', 'Lilac', 'Glass green', 'Ivory'],
    heading: ['生活有', '柔软的边。'],
    introduction: '工作里的问号，生活里的逗号。\n放进一段声音，慢慢聊。',
    note: '给今天，一个落点。',
    imageAlt: '青草绿玻璃回环接住一只淡紫色的柔软靠垫',
    palette: ['#F5EDCF', '#423048', '#D8C8EA', '#A7C96A', '#FFFBF1'],
  },
  'human-sample': {
    number: '04',
    name: '人间采样',
    english: 'HUMAN SAMPLE',
    description:
      '把声音做成一张有体温的独立刊物。青草绿与柿子橙直接碰撞，黑白人物进入专色印刷；粗重刊头、切口与套色偏移形成鲜明节奏。',
    designStyle: '独立刊物',
    designSlogan: '关掉窗口。开一扇窗。',
    paletteNames: ['Newsprint', 'Carbon', 'Grass ink', 'Persimmon', 'Blush'],
    heading: ['人间，', '正在发生。'],
    introduction: '关掉窗口，开一扇窗。\n聊聊下班以后，还在发生的事。',
    note: '声音里，有具体的生活。',
    imageAlt: '窗边感受晚风的成年人，青草绿与柿子橙的套色人像',
    palette: ['#F2F0E6', '#20241E', '#BCEF52', '#FA603A', '#EDC9D9'],
  },
  stillwood: {
    number: '05',
    name: '雾林来信',
    english: 'STILLWOOD',
    description:
      '深杉绿、潮湿木纹与一扇暖窗。把耳机的弧线藏进小屋的轮廓，像一封从林间寄来的信；天气照常经过，屋里保留自己的时间。',
    designStyle: '山间木屋',
    designSlogan: '窗外有风，屋里有一段声音。',
    paletteNames: ['Flax', 'Pine', 'Moss', 'Window light', 'Fog'],
    heading: ['山里起雾了。', '先坐一会儿。'],
    introduction: '消息还在来，天色慢慢暗了。\n留一段声音在身边。',
    note: '窗外有风，屋里有一段声音。',
    imageAlt: '山间的雾气笼罩杉林，一座木屋亮着暖色的窗',
    palette: ['#ECEBE1', '#263C35', '#A6AF94', '#C69D65', '#D4DAD2'],
  },
  'tidal-hours': {
    number: '06',
    name: '岛屿时间',
    english: 'TIDAL HOURS',
    description:
      '一座小岛，四周都是慢慢变淡的海。瓷白、潮蓝与砂色铺开大面积留白；细线耳机与水波相连，信息像岸边的潮痕，轻轻留在边上。',
    designStyle: '海上留白',
    designSlogan: '海面很宽，今天可以很小。',
    paletteNames: ['Porcelain', 'Deep tide', 'Sea glass', 'Sand', 'Horizon'],
    heading: ['潮水有潮水的时间。', '我有我的。'],
    introduction: '海面很宽。\n今天，可以只听一小段。',
    note: '海面很宽，今天可以很小。',
    imageAlt: '低可视度的灰蓝海面中，一座孤岛静静浮现',
    palette: ['#EFF1EB', '#344C57', '#B3C5C5', '#D9C9AA', '#D7E0DF'],
  },
  'window-seat': {
    number: '07',
    name: '靠窗的位置',
    english: 'WINDOW SEAT',
    description:
      '车窗外的城市横向掠过，车厢里的人保持清晰。石墨蓝、织物灰与暗琥珀像一张留下来的车票；圆角车窗和耳机弧线合成一处安静的角落。',
    designStyle: '通勤静处',
    designSlogan: '列车向前，我先听完这一段。',
    paletteNames: ['Seat linen', 'Carriage', 'Dull amber', 'Window grey', 'Evening'],
    heading: ['窗外很快。', '这一段，', '慢慢听。'],
    introduction: '下一站还没到。\n耳机里的声音，先陪你坐一会儿。',
    note: '列车向前，我先听完这一段。',
    imageAlt: '戴着耳机的成年乘客坐在通勤列车窗边，窗外城市掠过',
    palette: ['#E9E7DF', '#293940', '#CEB581', '#AEBBBE', '#657778'],
  },
  'alpine-bloom': {
    number: '08',
    name: '雪线花期',
    english: 'ALPINE BLOOM',
    description:
      '群山退进雾里，一朵高原蓝花在近处静静展开。冰川白、鼠尾草与褪色花蓝构成低可视度景深；纤细花瓣接住耳机轮廓，让微小的生活拥有自己的尺度。',
    designStyle: '高原微光',
    designSlogan: '世界自有速度。花有花期。',
    paletteNames: ['Glacial ivory', 'Slate', 'Petal blue', 'Alpine sage', 'Pollen'],
    heading: ['山很远。', '花开在眼前。'],
    introduction: '今天看得不远，也没关系。\n先听听身边这一点声音。',
    note: '世界自有速度。花有花期。',
    imageAlt: '薄雾与高海拔雪山之间，一朵蓝色高原花在近处静静开放',
    palette: ['#F0F1E9', '#404F50', '#B8C8D9', '#AFBCAC', '#D9C58D'],
  },
};

export const themeMedia = assets;

export function themeStyle(id: ThemeId): CSSProperties & Record<`--${string}`, string> {
  const [paper, ink, accent, secondary, surface] = themes[id].palette;
  return {
    '--paper': paper,
    '--ink': ink,
    '--accent': accent,
    '--secondary': secondary,
    '--surface': surface,
  };
}
