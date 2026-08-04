/**
 * 表格设置面板（Task 7）
 * 在 Popover 内提供：列可见性开关、列顺序（上移/下移）、固定列（左/右）、密度、重置默认
 * 通过受控 props 与 useTablePreferences 联动
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Checkbox,
  Divider,
  Popover,
  Segmented,
  Select,
  Space,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { TableColumnPref, TableDensity } from '@/hooks/useTablePreferences';

interface TableSettingsProps {
  /** 当前列配置（已按 prefs.order 排序） */
  columns: TableColumnPref[];
  density: TableDensity;
  onToggleVisible: (key: string, visible: boolean) => void;
  onMoveOrder: (key: string, direction: 'up' | 'down') => void;
  onSetFixed: (key: string, fixed: 'left' | 'right' | undefined) => void;
  onSetDensity: (density: TableDensity) => void;
  onReset: () => void;
}

const { Text } = Typography;

export default function TableSettings({
  columns,
  density,
  onToggleVisible,
  onMoveOrder,
  onSetFixed,
  onSetDensity,
  onReset,
}: TableSettingsProps) {
  const { t } = useTranslation();

  const sorted = useMemo(
    () => [...columns].sort((a, b) => a.order - b.order),
    [columns],
  );

  const fixOptions = useMemo(
    () => [
      { value: 'none', label: t('table.fixNone') },
      { value: 'left', label: t('table.fixLeft') },
      { value: 'right', label: t('table.fixRight') },
    ],
    [t],
  );

  const content = (
    <div style={{ width: 320, maxHeight: 420, overflow: 'auto' }}>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>
        {t('table.density')}
      </Text>
      <Segmented
        block
        value={density}
        onChange={(val) => onSetDensity(val as TableDensity)}
        options={[
          { value: 'compact', label: t('table.densityCompact') },
          { value: 'default', label: t('table.densityDefault') },
          { value: 'comfortable', label: t('table.densityComfortable') },
        ]}
      />

      <Divider style={{ margin: '12px 0' }} />

      <Text strong style={{ display: 'block', marginBottom: 8 }}>
        {t('table.columnVisible')}
      </Text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {sorted.map((col, index) => (
          <div
            key={col.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 0',
            }}
          >
            <Checkbox
              checked={col.visible}
              onChange={(e) => onToggleVisible(col.key, e.target.checked)}
            >
              <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {col.title}
              </span>
            </Checkbox>
            <Space size={2}>
              <Tooltip title={t('table.moveUp')}>
                <Button
                  type="text"
                  size="small"
                  icon={<ArrowUpOutlined />}
                  disabled={index === 0}
                  onClick={() => onMoveOrder(col.key, 'up')}
                />
              </Tooltip>
              <Tooltip title={t('table.moveDown')}>
                <Button
                  type="text"
                  size="small"
                  icon={<ArrowDownOutlined />}
                  disabled={index === sorted.length - 1}
                  onClick={() => onMoveOrder(col.key, 'down')}
                />
              </Tooltip>
            </Space>
            <Select
              size="small"
              style={{ width: 92, marginLeft: 'auto' }}
              value={col.fixed ?? 'none'}
              onChange={(val) =>
                onSetFixed(col.key, val === 'none' ? undefined : (val as 'left' | 'right'))
              }
              options={fixOptions}
            />
          </div>
        ))}
      </div>

      <Divider style={{ margin: '12px 0' }} />

      <Button block onClick={onReset}>
        {t('table.resetDefault')}
      </Button>
    </div>
  );

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      content={content}
      title={t('table.columnSettings')}
    >
      <Button icon={<SettingOutlined />}>{t('table.columnSettings')}</Button>
    </Popover>
  );
}