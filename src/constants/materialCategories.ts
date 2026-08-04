import i18n from '@/i18n';

/** 物料品类统一选项（inquiry/list + supplier + material 共用） */
const CATEGORIES = [
  { value: '工业电子', key: 'industrialElectronics' },
  { value: '五金件', key: 'hardware' },
  { value: '自动化', key: 'automation' },
  { value: '办公设备', key: 'officeEquipment' },
  { value: '包材', key: 'packaging' },
  { value: '劳保', key: 'protectiveEquipment' },
] as const;

/**
 * 返回国际化的品类选项（value 保持数据值不变，label 随语言切换）
 * 渲染时调用以确保语言切换后即时更新。
 */
export function getMaterialCategoryOptions(): { label: string; value: string }[] {
  return CATEGORIES.map((c) => ({
    label: i18n.t(`materialCategories.${c.key}`),
    value: c.value,
  }));
}

/** 兼容旧导出：value 不变，label 使用当前语言（模块加载时求值） */
export const MATERIAL_CATEGORY_OPTIONS = getMaterialCategoryOptions();
