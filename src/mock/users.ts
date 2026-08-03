/**
 * 用户模拟数据
 */
import type { User } from '@/types';

/** 当前登录用户：采购人员 李明辉 */
export const currentUser: User = {
  id: 'u-1',
  name: '李明辉',
  avatar: 'https://api.dicebear.com/7.x/initials/svg?seed=LMH&backgroundColor=165DFF',
  role: '采购人员',
  department: '采购部',
  organization: '总部采购中心',
};

/** 采购主管 王志强 */
export const supervisorUser: User = {
  id: 'u-2',
  name: '王志强',
  avatar: 'https://api.dicebear.com/7.x/initials/svg?seed=WZQ&backgroundColor=00B42A',
  role: '采购主管',
  department: '采购部',
  organization: '总部采购中心',
};

/** 管理员 周大海 */
export const adminUser: User = {
  id: 'u-6',
  name: '周大海',
  avatar: 'https://api.dicebear.com/7.x/initials/svg?seed=ZDH&backgroundColor=722ED1',
  role: '管理员',
  department: '信息中心',
  organization: '总部采购中心',
};

/** 全部用户列表 */
export const users: User[] = [
  currentUser,
  supervisorUser,
  {
    id: 'u-3',
    name: '张文静',
    avatar: 'https://api.dicebear.com/7.x/initials/svg?seed=ZWJ&backgroundColor=FF7D00',
    role: '采购人员',
    department: '采购部',
    organization: '华东分部',
  },
  {
    id: 'u-4',
    name: '刘建国',
    avatar: 'https://api.dicebear.com/7.x/initials/svg?seed=LJG&backgroundColor=165DFF',
    role: '采购人员',
    department: '采购部',
    organization: '华南分部',
  },
  {
    id: 'u-5',
    name: '陈晓燕',
    avatar: 'https://api.dicebear.com/7.x/initials/svg?seed=CXY&backgroundColor=F53F3F',
    role: '采购人员',
    department: '采购部',
    organization: '总部采购中心',
  },
  adminUser,
];

/** 采购组织列表 */
export const organizations: string[] = ['总部采购中心', '华东分部', '华南分部'];
