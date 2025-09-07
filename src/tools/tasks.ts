import { ToolResult, createToolResponse } from './files.js';

interface TaskUpdate {
  id: string;
  status: 'pending' | 'in_progress' | 'completed';
  notes?: string;
}

interface Task {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  notes?: string;
  updated_at?: string;
}

// Global task state
let activeTaskSession: {
  user_query: string;
  tasks: Task[];
  created_at: string;
} | null = null;

/**
 * Create a task list of subtasks to complete the user's request
 */
export async function createTasks(userQuery: string, tasks: Task[]): Promise<ToolResult> {
  try {
    // Validate task structure
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      if (!task.id || !task.description) {
        return createToolResponse(false, undefined, '', `Error: Task ${i} missing required fields (id, description)`);
      }

      // Set default status if not provided
      if (!task.status) {
        task.status = 'pending';
      }

      // Validate status
      if (!['pending', 'in_progress', 'completed'].includes(task.status)) {
        return createToolResponse(false, undefined, '', `Error: Invalid status '${task.status}' for task ${task.id}`);
      }
    }

    // Store the task list globally
    activeTaskSession = {
      user_query: userQuery,
      tasks,
      created_at: new Date().toISOString(),
    };

    // Return a deep copy to prevent mutation of historical displays
    const snapshot = {
      user_query: activeTaskSession.user_query,
      tasks: activeTaskSession.tasks.map((task) => ({ ...task })),
      created_at: activeTaskSession.created_at,
    };

    return createToolResponse(
      true,
      snapshot,
      `Created task list with ${tasks.length} tasks for: ${userQuery}`,
    );
  } catch (error) {
    return createToolResponse(false, undefined, '', `Error: Failed to create tasks - ${error}`);
  }
}

/**
 * Update the status of one or more tasks in the task list
 */
export async function updateTasks(taskUpdates: TaskUpdate[]): Promise<ToolResult> {
  try {
    if (!activeTaskSession) {
      return createToolResponse(false, undefined, '', 'Error: No task list exists. Create tasks first.');
    }

    // Track updates made
    const updatesMade: Array<{
      id: string;
      description: string;
      old_status: string;
      new_status: string;
    }> = [];

    for (const update of taskUpdates) {
      if (!update.id || !update.status) {
        return createToolResponse(false, undefined, '', 'Error: Task update missing required fields (id, status)');
      }

      // Validate status
      if (!['pending', 'in_progress', 'completed'].includes(update.status)) {
        return createToolResponse(false, undefined, '', `Error: Invalid status '${update.status}'`);
      }

      // Find and update the task
      let taskFound = false;
      for (const task of activeTaskSession.tasks) {
        if (task.id === update.id) {
          const oldStatus = task.status;
          task.status = update.status;

          // Add notes if provided
          if (update.notes) {
            task.notes = update.notes;
          }

          // Add update timestamp
          task.updated_at = new Date().toISOString();

          updatesMade.push({
            id: update.id,
            description: task.description,
            old_status: oldStatus,
            new_status: update.status,
          });
          taskFound = true;
          break;
        }
      }

      if (!taskFound) {
        return createToolResponse(false, undefined, '', `Error: Task '${update.id}' not found`);
      }
    }

    // Return a deep copy to prevent mutation of historical displays
    const snapshot = {
      user_query: activeTaskSession.user_query,
      tasks: activeTaskSession.tasks.map((task) => ({ ...task })),
      created_at: activeTaskSession.created_at,
    };

    return createToolResponse(
      true,
      snapshot,
      `Updated ${updatesMade.length} task(s)`,
    );
  } catch (error) {
    return createToolResponse(false, undefined, '', `Error: Failed to update tasks - ${error}`);
  }
}