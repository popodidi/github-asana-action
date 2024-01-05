let core;
let Asana;

async function getProjectByName(workspaceId, projectName) {
  let projectsApiInstance = new Asana.ProjectsApi();
  let opts = {
    'opt_fields': "name"
  };
  let projects = await projectsApiInstance.getProjectsForWorkspace(workspaceId, opts);
  let project = projects.data.find(project => project.name === projectName);
  return project;
}

async function addTaskToProjectIfFound(workspaceId, taskId, projectName) {
  let project = await getProjectByName(workspaceId, projectName);
  if (project) {
    let tasksApiInstance = new Asana.TasksApi();
    let body = { 'data': { 'project': project.gid } }
    await tasksApiInstance.addProjectForTask(body, taskId);
    core.info(`Added to: ${projectName}`);
  } else {
    core.error(`Asana project ${projectName} not found.`);
  }
}

async function moveTaskToSectionIfFound(workspaceId, taskId, projectName, sectionName) {
  let project = await getProjectByName(workspaceId, projectName);
  if (!project) {
    core.error(`Asana project ${projectName} not found.`);
    return;
  }
  let sectionsApiInstance = new Asana.SectionsApi();
  let sections = await sectionsApiInstance.getSectionsForProject(project.gid);
  let section = sections.data.find(section => section.name === sectionName);
  if (!section) {
    core.error(`Asana section ${sectionName} not found.`);
    return;
  }
  // add task to section
  let body = { 'data': { 'task': taskId } }
  await sectionsApiInstance.addTaskForSection(section.gid, { body });
}


async function asanaOperations(
  asanaPAT,
  workspaceId,
  targets,
  taskId,
  taskComment
) {

  let client = Asana.ApiClient.instance;
  let token = client.authentications['token'];
  token.accessToken = asanaPAT;

  let tasksApiInstance = new Asana.TasksApi();
  let opts = {
    'opt_fields': "projects,projects.name"
  };
  let task = (await tasksApiInstance.getTask(taskId, opts)).data;

  let projects = task.projects.map(project => project.name);
  targets.forEach(async target => {
    if (!projects.includes(target.project)) {
      await addTaskToProjectIfFound(workspaceId, taskId, target.project);
    }
    await moveTaskToSectionIfFound(workspaceId, taskId, target.project, target.section);
  });

  if (taskComment) {
    await client.tasks.addComment(taskId, {
      text: taskComment
    });
    core.info('Added the pull request link to the Asana task.');
  }
}

async function main() {
  core = await import('@actions/core');
  Asana = await import('asana');

  core.info('Starting Asana operations...');
  const ASANA_PAT = core.getInput('asana-pat'),
    WORKSPACE_ID = core.getInput('workspace'),
    TARGETS = core.getInput('targets'),
    TRIGGER_PHRASE = core.getInput('trigger-phrase'),
    TASK_COMMENT = core.getInput('task-comment'),
    PR_BODY = core.getInput('pr-body'),
    REGEX = new RegExp(
      `${TRIGGER_PHRASE} *\\[(.*?)\\]\\(https:\\/\\/app.asana.com\\/(\\d+)\\/(?<project>\\d+)\\/(?<task>\\d+).*?\\)`,
      'g'
    );
  let taskComment = null,
    targets = TARGETS? JSON.parse(TARGETS) : [],
    parseAsanaURL = null;

  if (!ASANA_PAT){
    throw({message: 'ASANA PAT Not Found!'});
  }
  if (TASK_COMMENT) {
    taskComment = `${TASK_COMMENT} ${PR_BODY.html_url}`;
  }
  while ((parseAsanaURL = REGEX.exec(PR_BODY)) !== null) {
    let taskId = parseAsanaURL.groups.task;
    if (taskId) {
      core.info(`Found Asana task: ${taskId}`);
      await asanaOperations(ASANA_PAT, WORKSPACE_ID, targets, taskId, taskComment);
    } else {
      core.info(`Invalid Asana task URL after the trigger phrase ${TRIGGER_PHRASE}`);
    }
  }
}

main().catch(err => core.setFailed(err.message));
