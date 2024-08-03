export default async (request, response) => {
	// Your logic here
	response.send('Page content goes here', request.path_parameters);
};
