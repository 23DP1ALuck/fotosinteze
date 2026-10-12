export type Department = { id: string; name: string }
export type Employee = { id: string; name: string; email: string; departmentId: string | null }
export type Project = { id: string; name: string; status: 'Planned' | 'Active' | 'Completed'; departmentIds: string[] }
export type TeamSection = 'Employees' | 'Departments' | 'Projects'
export type TeamData = { departments: Department[]; employees: Employee[]; projects: Project[] }
