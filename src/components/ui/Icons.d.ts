import type { SVGProps } from 'react';

type Icon = (props: SVGProps<SVGSVGElement>) => JSX.Element;
export const GridIcon: Icon; export const DeviceIcon: Icon; export const UsersIcon: Icon; export const DropIcon: Icon;
export const WrenchIcon: Icon; export const ChartIcon: Icon; export const RouteIcon: Icon; export const NavigationIcon: Icon;
export const PhoneIcon: Icon; export const ChevronDownIcon: Icon; export const BoxIcon: Icon; export const TagIcon: Icon;
export const PrinterIcon: Icon; export const SettingsIcon: Icon; export const SearchIcon: Icon; export const BellIcon: Icon;
export const PlusIcon: Icon; export const ArrowUpIcon: Icon; export const ArrowDownIcon: Icon; export const ChevronRightIcon: Icon;
export const EditIcon: Icon; export const TrashIcon: Icon; export const MenuIcon: Icon; export const GripIcon: Icon;
export const SortIcon: Icon; export const FunnelIcon: Icon; export const MegaphoneIcon: Icon; export const SparkleIcon: Icon;
export const AirMarkIcon: Icon;
export const iconMap: Record<string, Icon>;
